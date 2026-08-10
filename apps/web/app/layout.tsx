import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "HiveSwarm · Security evaluation",
  description: "Human-governed, multi-agent application security evaluation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to evaluation</a>
        {children}
      </body>
    </html>
  );
}
