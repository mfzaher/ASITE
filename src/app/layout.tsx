import type { Metadata } from "next";
import "./globals.css";
import "./governance.css";
export const metadata: Metadata = {
  title: "ECC | Quality & Information Governance",
  description:
    "H.O. audits, information compliance, QA/QC gates and source-linked lessons in one workspace.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
