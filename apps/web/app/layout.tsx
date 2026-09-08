import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@xyflow/react/dist/style.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "HiveSwarm · Security evaluation",
  description: "Human-governed, multi-agent application security evaluation.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <span
          hidden
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Evidence-first operator workspace; no permanent three-pane squeeze. OWN-WORLD: white and graphite, orange mark, blue selection, Geist, aligned tables. STORY: inspect scope, supervise work, review authority, trace evidence. FIRST VIEWPORT: compact navigation, run controls, asset map, decision queue. FORM: user-pinned enterprise standard; Vercel, Wiz, Apple, Cloudflare. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
        />
        <a className="skip-link" href="#main">
          Skip to workspace
        </a>
        {children}
      </body>
    </html>
  );
}
