import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '원모어 – 커플 데이트 플래너',
  description: '함께하는 모든 순간을 더 특별하게',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <style dangerouslySetInnerHTML={{ __html: `
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #EDE7EC; font-family: 'Pretendard', -apple-system, sans-serif; }
          @keyframes omUp {
            0% { transform: translateY(16px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          @keyframes omPop {
            0% { transform: scale(.85); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes omRing {
            0% { transform: scale(1); opacity: .5; }
            100% { transform: scale(2.4); opacity: 0; }
          }
          @keyframes omDash {
            to { stroke-dashoffset: -16; }
          }
          @keyframes omPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          ::-webkit-scrollbar { display: none; }
          * { scrollbar-width: none; }
          input, textarea, button { font-family: inherit; }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
