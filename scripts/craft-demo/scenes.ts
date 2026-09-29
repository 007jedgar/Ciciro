// Fixed scenes for the craft-defaults side-by-side demo. Each is one auto-draft
// beat as Ciciro would see it: the author's style.md, the editor context (the
// bible excerpts and chapter tail buildEditorContext would supply), the
// author's own prose the beat continues from, and the editor-written brief.
// The same scene goes through the current pipeline and the craft-defaults one.
//
// The continuity passages stand in for the author's prose, so they are written
// plainly and in distinct voices. Scene "dash-voice" is an author who writes
// with em dashes and has switched them on in style.md.

import type { ManuscriptKind } from "@/lib/manuscript-kind";

export type DemoScene = {
  id: string;
  title: string;
  /** What this scene is here to test, shown on the page. */
  tests: string;
  kind: ManuscriptKind;
  styleMd: string;
  /** Bible excerpts the editor would have in context (canon, characters). */
  bible: string;
  /** The author's prose the beat continues from (its last ~150 words). */
  continuity: string;
  goal: string;
  brief: string;
  wordTarget: number;
};

const NO_DASHES = '- Em dashes: not allowed; Ciciro uses a hyphen "-" instead.';

export const SCENES: DemoScene[] = [
  {
    id: "kitchen",
    title: "The house on Alder Street",
    tests: "Conflict said out loud rather than swallowed; no reconciliation the brief did not ask for.",
    kind: "novel",
    styleMd: `# Style\n- POV / tense: close third on Nora, past\n- Plain, dry, short paragraphs. Nora notices prices and dates.\n${NO_DASHES}\n`,
    bible:
      "canon.md: Nora (41) and her mother Ruth (72) co-own the house. Nora's brother Dan wants it sold. Ruth has had two falls this year.\ncharacters/ruth.md Voice: clipped, answers questions with questions, never says sorry.",
    continuity:
      "The realtor's card was still on the fridge, under the magnet from the pharmacy. Nora took it down and put it on the table between them.\n\n\"He came Tuesday,\" Ruth said. \"Nice boy. Wore his shoes in the house.\"\n\n\"Dan sent him.\"\n\n\"Dan sends a lot of things.\" Ruth pushed the card an inch back toward Nora with one finger. \"Did you eat?\"",
    goal: "Nora tells Ruth she agrees with Dan; Ruth refuses; they end further apart than they started.",
    brief:
      "POV close third on Nora, past tense. Beat: Nora finally says she thinks they should sell. Ruth refuses and turns it on Nora (the money Nora borrowed in 2019). The argument is open and specific, not hints. By the end they are further apart; nothing is resolved. Canon: Ruth has fallen twice this year; the house has steep back stairs; Dan lives in Tucson. Voice: Ruth clipped, answers questions with questions, never apologizes. Nora plain and careful with facts. Do NOT: reconcile them, have anyone cry, add new named characters, summarize the future.",
    wordTarget: 380,
  },
  {
    id: "noir",
    title: "Client at the Lexington Market",
    tests: "A wry, slangy first-person voice; no drift into earnest lyricism or stated themes.",
    kind: "novel",
    styleMd: `# Style\n- POV / tense: first person (Del), past\n- Wry, fast, a little mean. Baltimore slang. Jokes land on Del.\n${NO_DASHES}\n`,
    bible:
      "canon.md: Del Moreno, unlicensed PI, owes rent to her cousin. Client: Mrs. Okafor, whose son's car was found in the harbor with no one in it.\ncharacters/del.md Voice: short sentences, cheap jokes, hates being liked.",
    continuity:
      "Lexington Market at eleven on a Tuesday is crab cakes and pigeons and a man selling phone chargers out of a gym bag. I got there early so I could look like I'd been there longer.\n\nMrs. Okafor came in wearing church clothes on a weekday, which told me she'd been to a lawyer first and the lawyer had sent her to me, which told me what the lawyer thought of her chances.\n\nShe sat. She did not look at the food.",
    goal: "Mrs. Okafor hires Del; Del takes the job for the wrong reason.",
    brief:
      "POV first person, Del, past tense. Beat: Mrs. Okafor lays out what the police told her (car in the harbor, no body, case closed as a suicide) and puts cash on the table. Del takes the job mostly because of the rent. Del cracks at least two jokes, one of which falls flat. Canon: Del is unlicensed; the son is Tobi, 24; the car is a 2011 Camry. Voice: Del short and wry; Mrs. Okafor formal, precise, not tearful. Do NOT: have Del reflect on grief or justice, end on a line about the city, invent police names.",
    wordTarget: 400,
  },
  {
    id: "chase",
    title: "The toll bridge at Harrow",
    tests: "Escalation inside the beat and an ending at the turn, not after it.",
    kind: "novel",
    styleMd: `# Style\n- POV / tense: close third on Kess, past\n- YA fantasy, quick and physical. Magic has a cost (Kess's hands go numb).\n${NO_DASHES}\n`,
    bible:
      "canon.md: Kess (16) stole the ledger of the toll-keepers' guild. Wardens ride grey horses. Using wind-craft numbs Kess's hands for an hour.\ncharacters/kess.md Voice: swears by saints she does not believe in.",
    continuity:
      "The ledger was heavier than it had any right to be. Kess shoved it down the front of her coat and ran for the bridge, which was the stupidest way out of Harrow and the only one the wardens would not expect, because nobody crossed the toll bridge without paying.\n\nBehind her, the bell on the guildhall started up. Three strokes. Then three more.",
    goal: "Kess gets onto the bridge; the wardens close both ends; she is trapped with one choice left.",
    brief:
      "POV close third on Kess, past tense. Beat: Kess reaches the bridge; the gatekeeper recognizes her; wardens on grey horses arrive at the far end too. She uses wind-craft once to get past the gatekeeper and pays for it (hands numb). Each obstacle is worse than the last. End the moment she is caught between the two groups with the river below, and she decides to jump. Stop at the decision. Canon: the river is the Sallow, fast in spring. Do NOT: have her jump yet, add a mentor, explain the magic system.",
    wordTarget: 420,
  },
  {
    id: "harbor",
    title: "Tuesdays at the harbor wall",
    tests: "Grief shown through action; no weather mirroring the mood, no line explaining what it meant.",
    kind: "novel",
    styleMd: `# Style\n- POV / tense: close third on Walt, past\n- Understated. Walt does not name feelings; the prose doesn't either.\n${NO_DASHES}\n`,
    bible:
      "canon.md: Walt (68), widowed eight months (Jean). He still buys two coffees on Tuesdays. His neighbor Priya's boy, Sam (9), fishes off the harbor wall.\ncharacters/walt.md Voice: few words, dry, asks about practical things.",
    continuity:
      "He bought the two coffees at the kiosk because the girl had started them when she saw him coming and it seemed rude to stop her now. He carried them down to the wall, the second one in the crook of his arm.\n\nSam was already there with the rod his dad had left behind, casting too hard, the line going everywhere but out.",
    goal: "Walt gives Sam the second coffee and shows him how to cast; neither mentions Jean.",
    brief:
      "POV close third on Walt, past tense. Beat: Walt sits near Sam, ends up correcting his cast, and gives him the second coffee (Sam is nine; Walt realizes too late it's coffee and they swap it for Sam's juice box, or some small practical fix). Jean is never named. Nothing is said about loss. It is early April and ordinary weather. Voice: Walt few words, practical; Sam chatty, blunt. Do NOT: describe the sea or sky to carry feeling, have Walt think about Jean directly, end with a realization.",
    wordTarget: 360,
  },
  {
    id: "dash-voice",
    title: "Inventory",
    tests: "An author who writes with em dashes and fragments: the drafter should keep them (style.md switch on).",
    kind: "novel",
    styleMd:
      "# Style\n- POV / tense: first person (Ines), present\n- Em dashes: allowed\n- Ines thinks in lists and dashes; fragments are fine.\n",
    bible:
      "canon.md: Ines (29) is clearing out her late aunt Carmen's flat in Lisbon. Carmen kept every receipt. There is a locked tin under the bed.\ncharacters/ines.md Voice: lists, dashes, fragments, dry asides.",
    continuity:
      "Carmen's flat, room by room:\n\nKitchen \u2014 forty-one jars, all washed, none labelled. Bathroom \u2014 a hairbrush with her hair still in it, which I put in a bag and then took out of the bag and then put back. Bedroom \u2014 the bed made so tight you could bounce a coin, and under it, the tin.\n\nLocked. Of course.",
    goal: "Ines finds the key and opens the tin; inside is something that changes what she thought of Carmen.",
    brief:
      "POV first person, Ines, present tense. Beat: Ines searches for the tin's key (lists what she checks), finds it taped inside a jar lid, opens the tin: bundles of receipts from a Paris hotel, one night every March for 30 years, always for two. End on her counting them. Voice: Ines thinks in lists, uses em dashes and fragments, dry asides; keep that. Do NOT: have her guess who the second person was, add a phone call, reflect on love or secrets.",
    wordTarget: 330,
  },
  {
    id: "office",
    title: "The all-hands",
    tests: "Comedy in present tense; no triads or cadence by rule, no wise-sounding closers.",
    kind: "novel",
    styleMd: `# Style\n- POV / tense: close third on Priyanka, present\n- Deadpan workplace comedy. Short scenes. Jokes come from specifics.\n${NO_DASHES}\n`,
    bible:
      "canon.md: Priyanka is the only engineer left at Loopwell, a startup selling smart compost bins. CEO Brandon announces pivots monthly.\ncharacters/brandon.md Voice: says 'unlock' a lot, never finishes a list.",
    continuity:
      "The all-hands is in the kitchen because the conference room has been sublet to a dentist. There are six of them. Brandon stands on a chair.\n\n\"Team,\" he says. \"Big news.\"\n\nPriyanka opens her laptop, because the last big news was that the bins would talk, and she was the one who had to make them talk.",
    goal: "Brandon announces the bins will now also be a social network; Priyanka asks one precise question that sinks him.",
    brief:
      "POV close third on Priyanka, present tense. Beat: Brandon pitches the compost-bin social network (profiles for bins, bins can follow each other). The others react badly in different small ways. Priyanka asks one precise technical question (the bins have no screens and 2 MB of memory) and the room goes quiet. Brandon answers with 'unlock' and changes the subject. End there. Voice: deadpan. Do NOT: moralize about startups, give Priyanka a speech, end on a punchline that explains the joke.",
    wordTarget: 360,
  },
  {
    id: "screenplay",
    title: "SAFE HOUSE - NIGHT",
    tests: "Screenplay action lines: lean and visual, no mood mirroring or stated meaning in the directions.",
    kind: "screenplay",
    styleMd: `# Style\n- Standard screenplay format. Present tense. Lean action.\n${NO_DASHES}\n`,
    bible:
      "canon.md: RENA (40s, ex-cop) hides WITNESS TEO (19) in a rented flat. Teo testified against his uncle. Rena's phone is off; Teo's is not.\ncharacters/rena.md Voice: orders, not requests.",
    continuity:
      "INT. RENTED FLAT - NIGHT\n\nBare room. A mattress. Takeout cartons. RENA checks the window with two fingers on the blind.\n\nTEO sits against the wall, knees up, face lit blue by a phone.\n\nRENA\nWhose is that.\n\nTEO\nMine.",
    goal: "Rena realizes Teo's phone is on; they fight about it; a car stops outside.",
    brief:
      "One page of script continuing the scene. Beat: Rena takes the phone; Teo fights for it (it's how he talks to his sister); Rena pulls the battery. A car stops in the street below, engine running. End on Rena drawing her gun and killing the lamp. Voice: Rena gives orders; Teo is scared and angry, talks fast. Do NOT: add camera directions, write interior thoughts, explain the stakes in dialogue.",
    wordTarget: 300,
  },
  {
    id: "blog",
    title: "Why the bakery closes on Mondays now",
    tests: "Nonfiction craft defaults: no staged contrasts, inflation, stock words, or send-off.",
    kind: "blog",
    styleMd: `# Style\n- First person plural (the bakery). Warm, plain, specific numbers.\n${NO_DASHES}\n`,
    bible:
      "canon.md: Crumb & Co., a four-person bakery in Leeds. Since March they close Mondays. Sales per open day rose 11%; total weekly sales fell 2%. Nobody quit this year (two people quit last year).",
    continuity:
      "Since March we've been closed on Mondays. A few of you have asked why, and one of you asked if we were in trouble, which was kind of you. We're not. Here's what happened.",
    goal: "Explain the decision and its numbers honestly, including what it cost.",
    brief:
      "Blog post body continuing the intro. Explain: Mondays were the slowest day; the team was tired; four-day week since March. Numbers: sales per open day up 11%, total weekly sales down 2%, nobody quit this year vs two last year. Say plainly what it cost (the 2%, and customers who used to come Mondays). Voice: warm, plain, first person plural, specific. Do NOT: invent numbers, quote experts, end with a call to action or a slogan.",
    wordTarget: 320,
  },
];
