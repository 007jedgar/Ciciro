import { loadFont as loadNewsreader } from "@remotion/google-fonts/Newsreader";
import { loadFont as loadInstrumentSans } from "@remotion/google-fonts/InstrumentSans";

const { fontFamily: serifFamily } = loadNewsreader("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

const { fontFamily: sansFamily } = loadInstrumentSans("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export const fonts = {
  serif: serifFamily,
  sans: sansFamily,
};
