import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";
import prismMark from "./src/assets/prism-mark.png";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "Prism Docs",
      logo: {
        src: prismMark,
        alt: "Prism",
        replacesTitle: false,
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/OrekuD/prism" },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Quickstart", link: "/guides/quickstart/" },
          ],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
    mdx(),
  ],
});
