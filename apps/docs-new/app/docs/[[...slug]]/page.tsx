import { getPageImageUrl, getPageMarkdownUrl, source } from '@/lib/source';
import { PrismFooter } from '@/components/footer';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/glass/page';

import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { gitConfig } from '@/lib/shared';

/** Prism page metadata row (audience / scope / reviewed — design-system §9.7). */
function PageMeta({ page }: { page: (typeof source)['$inferPage'] }) {
  const data = page.data as unknown as {
    audience?: string;
    scope?: string;
    lastReviewed?: string;
  };
  if (!data.audience && !data.scope && !data.lastReviewed) return null;
  return (
    <p className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-fd-border pb-4 font-mono text-[11px] text-fd-muted-foreground">
      {data.audience && (
        <span>
          <span className="mr-1.5 text-[10px] uppercase tracking-[0.06em] text-fd-muted-foreground/60">
            Audience
          </span>
          {data.audience}
        </span>
      )}
      {data.scope && (
        <span>
          <span className="mr-1.5 text-[10px] uppercase tracking-[0.06em] text-fd-muted-foreground/60">
            Applies to
          </span>
          {data.scope}
        </span>
      )}
      {data.lastReviewed && (
        <span>
          <span className="mr-1.5 text-[10px] uppercase tracking-[0.06em] text-fd-muted-foreground/60">
            Reviewed
          </span>
          {data.lastReviewed}
        </span>
      )}
    </p>
  );
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <PageMeta page={page} />
      {/* Copy markdown / view options — restored from the Fumadocs
          template, styled to the Prism design (2px radius via CSS). */}
      <div className="prism-page-actions flex flex-row flex-wrap items-center gap-2 border-b border-fd-border pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      <PrismFooter fullBleed />
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
