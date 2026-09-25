// Regenerates sample.docx and sample.scriv.zip from readable sources.
// Run: node test/fixtures/import/build.mjs
import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const run = (text, { b, i } = {}) =>
  `<w:r>${b || i ? `<w:rPr>${b ? "<w:b/>" : ""}${i ? "<w:i/>" : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (runs, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;

const body = [
  para(run("The Lighthouse Keeper"), "Title"),
  para(run("Chapter One"), "Heading1"),
  para(run("The wind came in ") + run("hard", { i: true }) + run(" off the water, and ") + run("nobody", { b: true }) + run(" slept.")),
  para(run("* * *")),
  para(run("By morning the harbor was quiet.")),
  para(run("The Lamp"), "Heading2"),
  para(run("She climbed the stairs.")),
  para(run("Chapter Two"), "Heading1"),
  para(run("Rain on the glass, ") + `<w:del><w:r><w:delText>deleted</w:delText></w:r></w:del>` + run("still falling.")),
].join("");

const styles =
  `<w:styles ${W}>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
  `</w:styles>`;

writeFileSync(
  join(here, "sample.docx"),
  zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>${styles}`),
  })
);

const rtf = (text) =>
  `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n{\\fonttbl\\f0\\fswiss Helvetica;}\n{\\colortbl;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;}\n\\pard\\tx560\\pardirnatural\\partightenfactor0\n\\f0\\fs24 \\cf0 ${text}}`;

const item = (uuid, type, title, children = "", extra = "") =>
  `<BinderItem UUID="${uuid}" Type="${type}" Created="2026-01-01" Modified="2026-01-01"><Title>${title}</Title>${extra}${children ? `<Children>${children}</Children>` : ""}</BinderItem>`;

const scrivx =
  `<?xml version="1.0" encoding="UTF-8"?><ScrivenerProject Version="2.0" Creator="Scrivener3"><Binder>` +
  item("D0", "DraftFolder", "Draft",
    item("F1", "Folder", "The Storm",
      item("T1", "Text", "Arrival") + item("T2", "Text", "Night")) +
    item("T3", "Text", "Aftermath") +
    item("T4", "Text", "Cut scene", "", "<MetaData><IncludeInCompile>No</IncludeInCompile></MetaData>")) +
  item("R0", "ResearchFolder", "Research", item("T5", "Text", "Notes on tides")) +
  item("X0", "TrashFolder", "Trash") +
  `</Binder></ScrivenerProject>`;

const dir = "Lighthouse.scriv/";
writeFileSync(
  join(here, "sample.scriv.zip"),
  zipSync({
    [`${dir}Lighthouse.scrivx`]: strToU8(scrivx),
    [`${dir}Files/Data/T1/content.rtf`]: strToU8(rtf("The wind came in \\i hard\\i0  off the water.\\\n\\pard \\b nobody\\b0  slept, and caf\\'e9 lights burned.")),
    [`${dir}Files/Data/T2/content.rtf`]: strToU8(rtf("Night fell over the \\u8220?harbor\\u8221?.")),
    [`${dir}Files/Data/T3/content.rtf`]: strToU8(rtf("By morning it was quiet.")),
    [`${dir}Files/Data/T4/content.rtf`]: strToU8(rtf("Never used.")),
    [`${dir}Files/Data/T5/content.rtf`]: strToU8(rtf("Tide tables.")),
    "__MACOSX/._Lighthouse.scriv": strToU8("junk"),
  })
);
