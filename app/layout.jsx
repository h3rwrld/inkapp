import "./globals.css"

export const metadata = {
  title: "INKSAINT — dark fiction universe console",
  description:
    "A full AI writing studio for dark romance, suspense, and screen: story building, character vault, plot engines, a Markdown + Fountain writing desk, AI agents, canon intelligence tools, songwriting grid, ElevenLabs narration, and a project shelf with export.",
  generator: "v0.app",
}

export const viewport = {
  themeColor: "#100B10",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="bg-background">
      <body style={{ background: "#0E090F" }}>{children}</body>
    </html>
  )
}
