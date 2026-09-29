import type { CSSProperties } from "react";
import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Column } from "@react-email/column";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Link } from "@react-email/link";
import { Preview } from "@react-email/preview";
import { Row } from "@react-email/row";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import { FALLBACK_LINK_LABEL, type EmailBlock, type EmailContent } from "@/lib/email/content";

// The one Ciciro email layout. Colors are the app's own theme tokens
// (src/app/globals.css): Parchment inline, which every client renders, and
// Ember for mail apps that honor prefers-color-scheme (Apple Mail, iOS Mail,
// Outlook for Mac). Clients that repaint dark mode themselves (Gmail apps,
// Outlook.com) get the Outlook.com [data-ogsc] hints; the rest invert Parchment,
// which stays legible because nothing relies on a background image.

const LIGHT = {
  bg: "#f2ebe0",
  panel: "#faf6ef",
  ink: "#2a2218",
  inkSoft: "#6e6354",
  line: "#d9cfbd",
  accent: "#b4552d",
  onAccent: "#ffffff",
};

const DARK = {
  bg: "#1a1713",
  panel: "#221e19",
  ink: "#ece5d8",
  inkSoft: "#a99e8d",
  line: "#3a332b",
  accent: "#d9754a",
  onAccent: "#1a1713",
};

// The app's faces, with the fallbacks most mail clients end up using.
const SERIF = "Literata, Georgia, 'Times New Roman', serif";
const SANS = "'Source Sans 3', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500&family=Source+Sans+3:wght@400;600&display=swap";

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .em-body, .em-page { background-color: ${DARK.bg} !important; }
  .em-card { background-color: ${DARK.panel} !important; border-color: ${DARK.line} !important; }
  .em-ink { color: ${DARK.ink} !important; }
  .em-soft { color: ${DARK.inkSoft} !important; }
  .em-link { color: ${DARK.accent} !important; }
  .em-rule { border-color: ${DARK.line} !important; }
  .em-button { background-color: ${DARK.accent} !important; color: ${DARK.onAccent} !important; }
  .em-mark-light { display: none !important; }
  .em-mark-dark { display: block !important; max-height: none !important; overflow: visible !important; }
}
[data-ogsc] .em-ink { color: ${DARK.ink} !important; }
[data-ogsc] .em-soft { color: ${DARK.inkSoft} !important; }
[data-ogsc] .em-link { color: ${DARK.accent} !important; }
[data-ogsb] .em-button { background-color: ${DARK.accent} !important; }
@media only screen and (max-width: 600px) {
  .em-card-cell { padding: 28px 20px !important; }
  .em-heading { font-size: 22px !important; }
}
`;

const text: CSSProperties = {
  fontFamily: SANS,
  fontSize: "16px",
  lineHeight: "26px",
  color: LIGHT.ink,
  margin: "0 0 16px",
};

const soft: CSSProperties = { ...text, fontSize: "14px", lineHeight: "22px", color: LIGHT.inkSoft };

function Block({ block }: { block: EmailBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <Text className="em-ink" style={text}>
          {block.text}
        </Text>
      );
    case "note":
      return (
        <Text className="em-soft" style={{ ...soft, margin: "20px 0 0" }}>
          {block.text}
        </Text>
      );
    case "list":
      return (
        <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "0 0 16px" }}>
          <tbody>
            {block.items.map((item) => (
              <tr key={item}>
                <td
                  className="em-link"
                  style={{ ...text, color: LIGHT.accent, width: "20px", verticalAlign: "top", margin: 0, paddingBottom: "8px" }}
                >
                  •
                </td>
                <td className="em-ink" style={{ ...text, margin: 0, paddingBottom: "8px" }}>
                  {item}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "button":
      return (
        <Section style={{ margin: "8px 0 24px" }}>
          <Button
            href={block.href}
            className="em-button"
            style={{
              backgroundColor: LIGHT.accent,
              color: LIGHT.onAccent,
              fontFamily: SANS,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
              borderRadius: "8px",
              padding: "14px 24px",
              textDecoration: "none",
            }}
          >
            {block.label}
          </Button>
        </Section>
      );
    case "fallback-link":
      return (
        <Text className="em-soft" style={{ ...soft, margin: "0 0 16px" }}>
          {FALLBACK_LINK_LABEL}
          <br />
          <Link
            href={block.href}
            className="em-link"
            style={{ color: LIGHT.accent, wordBreak: "break-all", textDecoration: "underline" }}
          >
            {block.href}
          </Link>
        </Text>
      );
    case "details":
      return (
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ margin: "4px 0 24px", borderCollapse: "collapse" }}
        >
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label}>
                <td
                  className="em-soft em-rule"
                  style={{ ...soft, margin: 0, padding: "10px 0", borderTop: `1px solid ${LIGHT.line}` }}
                >
                  {row.label}
                </td>
                <td
                  className="em-ink em-rule"
                  align="right"
                  style={{
                    ...text,
                    margin: 0,
                    padding: "10px 0",
                    fontWeight: 600,
                    textAlign: "right",
                    borderTop: `1px solid ${LIGHT.line}`,
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/** The whole email for `content`. `origin` hosts the logo and the footer link. */
export function EmailLayout({ content, origin }: { content: EmailContent; origin: string }) {
  const markSize = 40;
  const mark: CSSProperties = { borderRadius: "10px" };
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{content.subject}</title>
        <link rel="stylesheet" href={FONTS_HREF} />
        <style>{DARK_CSS}</style>
      </Head>
      <Preview>{content.preview}</Preview>
      <Body className="em-body" style={{ backgroundColor: LIGHT.bg, margin: 0, padding: 0 }}>
        <Section className="em-page" style={{ backgroundColor: LIGHT.bg, padding: "32px 12px 40px" }}>
          <Container style={{ maxWidth: "560px" }}>
            <Section style={{ padding: "0 4px 20px" }}>
              <Row>
                <Column style={{ width: `${markSize + 12}px`, verticalAlign: "middle" }}>
                  {origin ? (
                    <>
                      <Img
                        className="em-mark-light"
                        src={`${origin}/brand/email-mark-warm.png`}
                        width={markSize}
                        height={markSize}
                        alt="Ciciro"
                        style={mark}
                      />
                      {/* Hidden unless the client supports dark-mode CSS. */}
                      <div className="em-mark-dark" style={{ display: "none", maxHeight: 0, overflow: "hidden", msoHide: "all" } as CSSProperties}>
                        <Img
                          src={`${origin}/brand/email-mark-ink.png`}
                          width={markSize}
                          height={markSize}
                          alt="Ciciro"
                          style={mark}
                        />
                      </div>
                    </>
                  ) : null}
                </Column>
                <Column style={{ verticalAlign: "middle" }}>
                  <Text
                    className="em-ink"
                    style={{ ...text, fontFamily: SERIF, fontSize: "22px", lineHeight: "28px", fontWeight: 500, margin: 0 }}
                  >
                    Ciciro
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section
              className="em-card"
              style={{
                backgroundColor: LIGHT.panel,
                border: `1px solid ${LIGHT.line}`,
                borderRadius: "14px",
              }}
            >
              <Row>
                <Column className="em-card-cell" style={{ padding: "36px 36px 32px" }}>
                  <Heading
                    as="h1"
                    className="em-ink em-heading"
                    style={{
                      fontFamily: SERIF,
                      fontSize: "26px",
                      lineHeight: "34px",
                      fontWeight: 500,
                      color: LIGHT.ink,
                      margin: "0 0 20px",
                    }}
                  >
                    {content.heading}
                  </Heading>
                  {content.blocks.map((block, index) => (
                    <Block key={index} block={block} />
                  ))}
                </Column>
              </Row>
            </Section>

            <Section style={{ padding: "24px 20px 0" }}>
              <Text className="em-soft" style={{ ...soft, fontSize: "13px", lineHeight: "20px", textAlign: "center", margin: "0 0 8px" }}>
                {content.footer}
              </Text>
              <Text className="em-soft" style={{ ...soft, fontSize: "13px", lineHeight: "20px", textAlign: "center", margin: 0 }}>
                Ciciro, an AI writing assistant and manuscript editor
                {origin ? (
                  <>
                    {" · "}
                    <Link href={origin} className="em-link" style={{ color: LIGHT.accent }}>
                      {origin.replace(/^https?:\/\//, "")}
                    </Link>
                  </>
                ) : null}
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
