import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useFocusEffect } from "expo-router";
import { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { CARRY_LEAVE_MS, CARRY_MS, CARRY_PUSH_MS, CARRY_STAGGER_MS } from "./motion";
import { addChips, chipsBefore, type StoryChip } from "./onboarding-story";
import type { OnboardingStep } from "./onboarding-flow";
import { useReduceMotion } from "./use-reduce-motion";

/**
 * The "carry": the card a person taps in the onboarding becomes a chip in a
 * header that stays put, so their answers visibly pile up as they go (see
 * AGENTS.md "Pre-signup onboarding"). Every onboarding screen sits under one
 * layout (`app/onboarding/_layout.tsx`) that owns the header - thread, back and
 * Skip, and the row of chips - so none of it re-mounts between steps. A screen
 * hands its step, back and Skip to it (`useOnboardingChrome`), and asks it to
 * fly the card it was tapped on into a chip (`useCarry`).
 *
 * The flight is the same idea as `shared-title-morph.tsx`: measure the source,
 * animate a floating copy above everything, reveal the target when it lands.
 * Only one is ever in the air at a time (one tap per screen), so the shell keeps
 * a single list of flights rather than a channel per card.
 */

export type Frame = { x: number; y: number; width: number; height: number };

/** Anything with a window frame to measure: a View or a Text. */
export type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

/** How the floating copy starts out: the card's own surface and title, and the rest of its face. */
export type CarryLook = {
  background: string;
  border: string;
  borderWidth: number;
  radius: number;
  title: { text: string; color: string; fontFamily?: string; fontSize: number };
  /** Everything on the card but its title, laid out at the card's size; it fades while the card shrinks. */
  rest?: ReactNode;
};

export type CarryRequest = {
  chip: StoryChip;
  card: Measurable | null;
  title: Measurable | null;
  look: CarryLook;
};

export type Flight = {
  key: string;
  chip: StoryChip;
  look: CarryLook;
  card: Frame;
  title: Frame;
  chipFrame: Frame;
  label: Frame;
  delay: number;
};

export type CarryOptions = {
  /** Resolve when the chip has landed, not as the next screen is due: for the last step before signup, which leaves the shell. */
  settle?: boolean;
  /** Called as the copies take off (or at once when there is nothing to fly): the screen starts leaving then, not at the tap. */
  onTakeoff?: () => void;
};

type Handlers = { onBack: () => void; onSkip: () => void };

type ShellValue = {
  chips: readonly StoryChip[];
  /** Chips whose flight has not landed, kept in the row (it needs their place) but not shown. */
  hidden: ReadonlySet<string>;
  flights: readonly Flight[];
  step: OnboardingStep;
  steps: readonly OnboardingStep[];
  /** 0 normally, 1 in the focus demo's focus mode: the header closes up behind it. */
  focus: SharedValue<number>;
  /** The header's height when open, once measured. */
  headerHeight: SharedValue<number>;
  focusHidden: boolean;
  /** True while a carry is in the air: back, Skip and the screens ignore taps until the next screen is pushed. */
  carrying: boolean;
  setFocusHidden: (hidden: boolean) => void;
  claim: (chrome: { step: OnboardingStep; steps: readonly OnboardingStep[]; handlers: MutableRefObject<Handlers> }) => void;
  back: () => void;
  skip: () => void;
  retract: (step: OnboardingStep) => void;
  fly: (requests: readonly CarryRequest[], options?: CarryOptions) => Promise<void>;
  landed: (key: string) => void;
  registerChip: (id: string, node: Measurable | null) => void;
  registerLabel: (id: string, node: Measurable | null) => void;
  registerRoot: (node: Measurable | null) => void;
};

const OnboardingShellContext = createContext<ShellValue | null>(null);

export function useOnboardingShell(): ShellValue {
  const shell = useContext(OnboardingShellContext);
  if (!shell) throw new Error("useOnboardingShell must be used inside the onboarding layout");
  return shell;
}

function measure(node: Measurable | null | undefined): Promise<Frame | null> {
  return new Promise((resolve) => {
    if (!node) return resolve(null);
    try {
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
    } catch {
      resolve(null);
    }
  });
}

/** Two frames: long enough for a state change to be laid out, so a chip just added can be measured. */
function afterLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function OnboardingShellProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const [chips, setChips] = useState<readonly StoryChip[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [flights, setFlights] = useState<readonly Flight[]>([]);
  const [chrome, setChrome] = useState<{ step: OnboardingStep; steps: readonly OnboardingStep[] }>({
    step: "goal",
    steps: [],
  });
  const [focusHidden, setFocusHidden] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const inFlight = useRef(0);
  const focus = useSharedValue(0);
  const headerHeight = useSharedValue(0);

  const handlers = useRef<MutableRefObject<Handlers> | null>(null);
  const chipNodes = useRef(new Map<string, Measurable>()).current;
  const labelNodes = useRef(new Map<string, Measurable>()).current;
  const root = useRef<Measurable | null>(null);
  const landings = useRef(new Map<string, () => void>()).current;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const claim = useCallback<ShellValue["claim"]>((next) => {
    handlers.current = next.handlers;
    setChrome((current) =>
      current.step === next.step && current.steps.join() === next.steps.join()
        ? current
        : { step: next.step, steps: next.steps }
    );
  }, []);

  const back = useCallback(() => {
    if (inFlight.current === 0) handlers.current?.current.onBack();
  }, []);
  const skip = useCallback(() => {
    if (inFlight.current === 0) handlers.current?.current.onSkip();
  }, []);
  const retract = useCallback((step: OnboardingStep) => {
    setChips((current) => {
      const kept = chipsBefore(current, step);
      return kept.length === current.length ? current : kept;
    });
  }, []);

  const registerChip = useCallback(
    (id: string, node: Measurable | null) => {
      if (node) chipNodes.set(id, node);
      else chipNodes.delete(id);
    },
    [chipNodes]
  );
  const registerLabel = useCallback(
    (id: string, node: Measurable | null) => {
      if (node) labelNodes.set(id, node);
      else labelNodes.delete(id);
    },
    [labelNodes]
  );
  const registerRoot = useCallback((node: Measurable | null) => {
    root.current = node;
  }, []);

  const unhide = useCallback((ids: readonly string[]) => {
    setHidden((current) => {
      if (!ids.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const landed = useCallback(
    (key: string) => {
      if (!mounted.current) return;
      setFlights((current) => current.filter((flight) => flight.key !== key));
      unhide([key]);
      landings.get(key)?.();
      landings.delete(key);
    },
    [landings, unhide]
  );

  const carry = useCallback<ShellValue["fly"]>(
    async (requests, options) => {
      const added = requests.map((request) => request.chip);
      // Reduce motion: no flight, the chips just fade into the row.
      if (reduceMotion || requests.length === 0) {
        setChips((current) => addChips(current, added));
        options?.onTakeoff?.();
        return;
      }
      const ids = added.map((chip) => chip.id);
      const [origin, sources] = await Promise.all([
        measure(root.current),
        Promise.all(requests.map(async (request) => ({ card: await measure(request.card), title: await measure(request.title) }))),
      ]);
      // The chips go into the row now, unseen, so their places can be measured.
      setHidden((current) => new Set([...current, ...ids]));
      setChips((current) => addChips(current, added));
      await afterLayout();
      const targets = await Promise.all(
        ids.map(async (id) => ({ chip: await measure(chipNodes.get(id)), label: await measure(labelNodes.get(id)) }))
      );
      const dx = origin?.x ?? 0;
      const dy = origin?.y ?? 0;
      const inShell = (frame: Frame): Frame => ({ ...frame, x: frame.x - dx, y: frame.y - dy });
      const built: Flight[] = [];
      const grounded: string[] = [];
      requests.forEach((request, i) => {
        const source = sources[i]!;
        const target = targets[i]!;
        if (!source.card || !source.title || !target.chip || !target.label) {
          // Nothing to fly from or to: the chip simply appears where it belongs.
          grounded.push(request.chip.id);
          return;
        }
        built.push({
          key: request.chip.id,
          chip: request.chip,
          look: request.look,
          card: inShell(source.card),
          title: inShell(source.title),
          chipFrame: inShell(target.chip),
          label: inShell(target.label),
          delay: built.length * CARRY_STAGGER_MS,
        });
      });
      if (grounded.length > 0) unhide(grounded);
      options?.onTakeoff?.();
      if (built.length === 0) return;
      const settled = options?.settle
        ? Promise.all(built.map((flight) => new Promise<void>((resolve) => landings.set(flight.key, resolve))))
        : null;
      setFlights((current) => [...current.filter((flight) => !built.some((b) => b.key === flight.key)), ...built]);
      // The next screen is due as the card is on its way, not when it has landed.
      // A flight that never reports in (the app was backgrounded mid-air) must not hold the screen forever.
      const lastLanding = CARRY_MS + (built.length - 1) * CARRY_STAGGER_MS + 400;
      await (settled ? Promise.race([settled, wait(lastLanding)]) : wait(CARRY_PUSH_MS));
    },
    [reduceMotion, chipNodes, labelNodes, landings, unhide]
  );

  const fly = useCallback<ShellValue["fly"]>(
    async (requests, options) => {
      inFlight.current += 1;
      setCarrying(true);
      const ceiling = CARRY_MS + requests.length * CARRY_STAGGER_MS + 1000;
      try {
        await Promise.race([carry(requests, options), wait(ceiling)]);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0 && mounted.current) setCarrying(false);
      }
    },
    [carry]
  );

  const value = useMemo<ShellValue>(
    () => ({
      chips,
      hidden,
      flights,
      step: chrome.step,
      steps: chrome.steps,
      focus,
      headerHeight,
      focusHidden,
      carrying,
      setFocusHidden,
      claim,
      back,
      skip,
      retract,
      fly,
      landed,
      registerChip,
      registerLabel,
      registerRoot,
    }),
    [chips, hidden, flights, chrome, focus, headerHeight, focusHidden, carrying, claim, back, skip, retract, fly, landed, registerChip, registerLabel, registerRoot]
  );

  return <OnboardingShellContext.Provider value={value}>{children}</OnboardingShellContext.Provider>;
}

/**
 * What a screen tells the header while it is the one on show: where it sits on
 * the thread, and what back and Skip do. Showing a step also takes back the
 * chips it and the steps after it gave (see `chipsBefore`).
 */
export function useOnboardingChrome({
  step,
  steps,
  onBack,
  onSkip,
}: {
  step: OnboardingStep;
  steps: readonly OnboardingStep[];
  onBack: () => void;
  onSkip: () => void;
}) {
  const { claim, retract } = useOnboardingShell();
  const handlers = useRef<Handlers>({ onBack, onSkip });
  handlers.current = { onBack, onSkip };
  const stepsKey = steps.join();
  useFocusEffect(
    useCallback(() => {
      claim({ step, steps, handlers });
      retract(step);
      // `steps` is read through its key: a fresh array every render is the same thread.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claim, retract, step, stepsKey])
  );
}

/**
 * Flying a card into its chip from a screen. `fly` is for the tap: the rest of
 * the screen fades (`fadeStyle`, applied by `OnboardingFrame`), the card takes
 * off, and it resolves when the next screen is due. The fade is undone when the
 * screen is shown again, so coming back to it finds it whole. A second tap
 * while one is in the air does nothing (`fly` resolves false), and so does a
 * flight whose screen was left meanwhile (a hardware back or an edge swipe), so
 * its caller never pushes on top of wherever the person went.
 */
export function useCarry() {
  const { fly: shellFly, retract } = useOnboardingShell();
  const reduceMotion = useReduceMotion();
  const leave = useSharedValue(0);
  const busy = useRef(false);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      leave.value = 0;
      busy.current = false;
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, [leave])
  );
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 1 - leave.value }));
  const fly = useCallback(
    async (requests: readonly CarryRequest[], options?: CarryOptions): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      await shellFly(requests, {
        ...options,
        // The screen fades as the copies take off, so the card is never missing from it
        // before its copy is there.
        onTakeoff: () => {
          if (!reduceMotion) leave.value = withTiming(1, { duration: CARRY_LEAVE_MS });
        },
      });
      if (focused.current) return true;
      const step = requests[0]?.chip.step;
      if (step) retract(step);
      return false;
    },
    [shellFly, retract, reduceMotion, leave]
  );
  return { fly, fadeStyle };
}

/** Refs for the cards and titles a screen flies from, by option id. */
export function useCarryNodes() {
  const nodes = useRef(new Map<string, { card: Measurable | null; title: Measurable | null }>()).current;
  return useMemo(() => {
    const entry = (id: string) => {
      let found = nodes.get(id);
      if (!found) {
        found = { card: null, title: null };
        nodes.set(id, found);
      }
      return found;
    };
    return {
      cardRef: (id: string) => (node: Measurable | null) => {
        entry(id).card = node;
      },
      titleRef: (id: string) => (node: Measurable | null) => {
        entry(id).title = node;
      },
      get: (id: string) => entry(id),
    };
  }, [nodes]);
}
