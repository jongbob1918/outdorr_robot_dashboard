import "./globals.css";

export const metadata = {
  title: "서오릉 로봇 관제",
  description: "서오릉 야외 로봇을 위한 브라우저 기반 관제 대시보드 데모",
};

export const viewport = {
  themeColor: "#edf2ee",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
