import path from 'path';
import {
  PageIndexInfo,
  ReplaceRule,
  Header,
  MDX_REGEXP,
} from '@rspress/shared';
import { htmlToText } from 'html-to-text';
import fs from '@modern-js/utils/fs-extra';
import { compile } from '@rspress/mdx-rs';
import { flattenMdxContent, loadFrontMatter } from '@/node/utils';
import { RouteService } from '@/node/route/RouteService';
import { applyReplaceRules } from '@/node/utils/applyReplaceRules';
import { importStatementRegex } from '@/node/constants';

export async function extractPageData(
  replaceRules: ReplaceRule[],
  alias: Record<string, string | string[]>,
  domain: string,
  root: string,
  routeService: RouteService,
): Promise<(PageIndexInfo | null)[]> {
  return Promise.all(
    routeService
      .getRoutes()
      .filter(route => MDX_REGEXP.test(route.absolutePath))
      .map(async (route, index) => {
        let content: string = await fs.readFile(route.absolutePath, 'utf8');
        const { frontmatter, content: strippedFrontMatter } = loadFrontMatter(
          content,
          route.absolutePath,
          root,
        );

        // 1. Replace rules for frontmatter & content
        Object.keys(frontmatter).forEach(key => {
          if (typeof frontmatter[key] === 'string') {
            frontmatter[key] = applyReplaceRules(
              frontmatter[key],
              replaceRules,
            );
          }
        });

        // TODO: we will find a more efficient way to do this
        const flattenContent = await flattenMdxContent(
          applyReplaceRules(strippedFrontMatter, replaceRules),
          route.absolutePath,
          alias,
        );

        content = flattenContent.replace(importStatementRegex, '');

        const {
          html,
          title,
          toc: rawToc,
        } = await compile({
          value: content,
          filepath: route.absolutePath,
          development: process.env.NODE_ENV !== 'production',
          root,
        });

        if (!title?.length && !frontmatter && !frontmatter.title?.length) {
          return null;
        }
        content = htmlToText(String(html), {
          wordwrap: 80,
          selectors: [
            {
              selector: 'a',
              options: {
                ignoreHref: true,
              },
            },
            {
              selector: 'img',
              format: 'skip',
            },
            ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => ({
              selector: tag,
              options: {
                uppercase: false,
              },
            })),
          ],
          tables: true,
          longWordSplit: {
            forceWrapOnLimit: true,
          },
        });
        if (content.startsWith(title)) {
          // Remove the title from the content
          content = content.slice(title.length);
        }

        const toc: Header[] = rawToc.map(item => {
          // If the item.id ends with '-number', we take the number
          const match = item.id.match(/-(\d+)$/);
          let position = -1;
          if (match) {
            for (let i = 0; i < Number(match[1]); i++) {
              position = content.indexOf(`\n${item.text}#\n\n`, position + 1);
            }
          }
          return {
            ...item,
            charIndex: content.indexOf(`\n${item.text}#\n\n`, position + 1),
          };
        });

        return {
          id: index,
          title: frontmatter.title || title,
          routePath: route.routePath,
          lang: route.lang,
          toc,
          domain,
          // Stripped frontmatter content
          content,
          frontmatter: {
            ...frontmatter,
            __content: undefined,
          },
          version: route.version,
          _filepath: route.absolutePath,
          _relativePath: path.relative(root, route.absolutePath),
        };
      }),
  );
}