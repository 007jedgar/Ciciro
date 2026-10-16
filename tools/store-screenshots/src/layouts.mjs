// One function per frame, each returning the HTML of that frame's stage (the
// picture under the headline). Positions are percentages of the composition's
// width (the device), so a layout survives every canvas. A frame without a
// phone draws on the full canvas instead.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Keeps you *five minutes*" -> escaped HTML with the starred word in <em>. */
export function rich(text) {
  return esc(text).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export const MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="14.5" cy="24" r="3.6" fill="#ff5a40"/><circle cx="24" cy="24" r="3.6" fill="#ff5a40"/><circle cx="33.5" cy="24" r="3.6" fill="#ff5a40"/></svg>`;

function stamp(lines, style) {
  const [mid, ring] = lines;
  const ringText = `${ring} · CICIRO · ${ring} · CICIRO ·`;
  return `<div class="stamp" style="${style}"><svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="56" stroke-width="3"/><circle cx="60" cy="60" r="40" stroke-width="1.5"/>
    <defs><path id="ring" d="M60 60 m-48 0 a48 48 0 1 1 96 0 a48 48 0 1 1 -96 0"/></defs>
    <text><textPath href="#ring">${esc(ringText)}</textPath></text>
    <text x="60" y="66" text-anchor="middle" class="mid">${esc(mid)}</text></svg></div>`;
}

/** The phone in its bezel, filled with a capture. */
function phone(ctx, name, extra = "") {
  const cap = ctx.cap(name);
  const island = ctx.target.device === "iphone" && ctx.meta.island === false ? `<i class="island"></i>` : "";
  return `<div class="dev ${ctx.target.device}" style="${extra}"><div class="screen"><img src="${cap.uri}" alt=""></div>${island}</div>`;
}

/** A piece of a capture as a floating card. rect is fractions of the capture. */
function cutout(ctx, name, rect, style, cls = "") {
  const cap = ctx.crop(name, rect);
  return `<figure class="cut ${cls}" style="${style}"><img src="${cap.uri}" alt=""></figure>`;
}

/** The tablet's value when the target is a tablet, else the phone's. */
const byForm = (ctx, phoneValue, tabletValue) => (ctx.target.form === "tablet" ? tabletValue : phoneValue);

const comp = (inner, style = "") => `<div class="comp" style="${style}">${inner}</div>`;

export const LAYOUTS = {
  hero(ctx) {
    return `
      <div style="position:absolute;left:0;right:0;top:32%;bottom:0;background:var(--blue);border-radius:10px 0 0 0;box-shadow:0 -4px 30px rgba(0,0,0,.35)"></div>
      <div style="position:absolute;right:0;top:36%;width:50px;height:230px;background:var(--vermilion);border-radius:10px 0 0 10px;display:flex;align-items:center;justify-content:center;box-shadow:-6px 4px 14px -6px rgba(0,0,0,.5);z-index:2">
        <span style="writing-mode:vertical-rl;font:400 24px var(--serif);color:#141414">Chapter 12</span></div>
      ${comp(
        `${phone(ctx, "editor")}
         ${stamp(ctx.copy.stamp, "right:-10%;top:calc(-17 * var(--c));width:calc(27 * var(--c));aspect-ratio:1;transform:rotate(12deg)")}`,
        "top:6%"
      )}`;
  },

  screenplay(ctx) {
    return comp(
      `${phone(ctx, "screenplay")}
       ${cutout(ctx, "screenplay-pages", ctx.rects.scriptPage, byForm(ctx, "right:-12%;top:52%;width:60%;transform:rotate(2.2deg)", "right:-10%;top:66%;width:62%;transform:rotate(2deg)"), "taped")}`,
      "top:2%"
    );
  },

  reminders(ctx) {
    return comp(
      `${phone(ctx, "reminder")}
       ${cutout(ctx, "notification", ctx.rects.notification, byForm(ctx, "left:-8%;top:-1%;width:116%;transform:rotate(-2.2deg)", "left:-4%;top:-2%;width:108%;transform:rotate(-1.4deg)"), "notif")}`,
      "top:6%"
    );
  },

  commute(ctx) {
    const chips = ctx.copy.chips;
    return comp(
      `${phone(ctx, "sprint")}
       <span class="chip" style="left:-12%;top:22%;transform:rotate(-4deg)">${esc(chips[0])}</span>
       <span class="chip" style="right:-11%;top:36%;transform:rotate(3deg)">${esc(chips[1])}</span>
       <span class="chip" style="left:-8%;top:58%;transform:rotate(-2deg)">${esc(chips[2])}</span>`,
      "top:2%"
    );
  },

  exercise(ctx) {
    return comp(
      `${phone(ctx, "exercise-intro")}
       ${cutout(ctx, "weekly-review-next", ctx.rects.weeklyNext, byForm(ctx, "right:-10%;top:64%;width:76%;transform:rotate(2deg)", "right:-8%;top:68%;width:84%;transform:rotate(1.6deg)"), "taped")}`,
      "top:2%"
    );
  },

  suggest(ctx) {
    return comp(
      `${phone(ctx, "suggestions")}
       ${cutout(ctx, "suggestions", ctx.rects.suggestionCard, byForm(ctx, "left:-10%;top:22%;width:112%;transform:rotate(-1.8deg)", "left:-6%;top:44%;width:112%;transform:rotate(-1.4deg)"))}`,
      "top:2%"
    );
  },

  bible(ctx) {
    return comp(
      `${phone(ctx, "bible")}
       ${cutout(ctx, "bible-entry", ctx.rects.bibleEntry, byForm(ctx, "left:-10%;top:60%;width:92%;transform:rotate(-2deg)", "left:-8%;top:62%;width:78%;transform:rotate(-1.8deg)"), "taped")}`,
      "top:2%"
    );
  },

  themes(ctx) {
    const names = ctx.copy.names;
    const slot = (name, label, style, sw) =>
      `<div style="position:absolute;--sw:${sw}px;--c:calc(var(--sw)/100);width:var(--sw);${style}">
         <div style="font:500 20px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--soft);margin-bottom:18px;text-align:center">${esc(label)}</div>
         ${phone(ctx, name)}</div>`;
    return `
      ${slot("theme-ciciro", names[0], `left:${byForm(ctx, -70, -34)}px;top:9%;transform:rotate(-5deg);transform-origin:50% 100%`, byForm(ctx, 500, 460))}
      ${slot("theme-bookshelf", names[2], `right:${byForm(ctx, -70, -34)}px;top:9%;transform:rotate(5deg);transform-origin:50% 100%`, byForm(ctx, 500, 460))}
      ${slot("theme-night", names[1], "left:50%;top:0;transform:translateX(-50%);z-index:3", byForm(ctx, 600, 560))}`;
  },

  scan(ctx) {
    return comp(
      `${phone(ctx, "scan")}
       <div style="position:absolute;left:-10%;right:-10%;top:42%;z-index:9;transform:rotate(-8deg);background:#141414;color:#ffd84d;text-align:center;font:700 34px var(--mono);letter-spacing:.12em;padding:26px 0">PLANNED · NOT SHIPPED · DO NOT UPLOAD</div>`,
      "top:2%"
    );
  },
};

/** Play's 1024x500 feature graphic: its own composition, not a crop of a frame. */
export function featureGraphic(ctx) {
  const { copy } = ctx;
  return `
    <div class="frame bg-ink target-play-feature" style="height:${ctx.canvasH}px;flex-direction:row;--dw:${ctx.target.deviceWidth}px">
      <div style="position:absolute;right:0;top:0;bottom:0;width:41%;background:var(--blue)"></div>
      <div style="position:absolute;right:0;top:64px;width:34px;height:150px;background:var(--vermilion);border-radius:8px 0 0 8px;display:flex;align-items:center;justify-content:center;z-index:2">
        <span style="writing-mode:vertical-rl;font:400 15px var(--serif);color:#141414">Chapter 12</span></div>
      <div style="position:relative;z-index:3;width:60%;padding:48px 0 0 56px">
        <div class="brand" style="font-size:32px;margin-bottom:30px">${MARK}<span>Ciciro</span></div>
        <h1 style="font-size:62px;max-width:500px">${rich(copy.headline)}</h1>
      </div>
      <p style="position:absolute;left:56px;bottom:40px;z-index:3;font:500 13px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--soft);max-width:400px;line-height:1.55">${esc(copy.kicker)}</p>
      <div class="comp" style="left:auto;right:7%;transform:none;top:62px;z-index:4">
        ${phone(ctx, "editor")}
      </div>
      ${stamp(["5 MIN", "COUNTED"], "left:49%;top:310px;width:128px;height:128px;transform:rotate(-14deg)")}
    </div>`;
}
