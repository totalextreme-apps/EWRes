import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {exists, readFile, writeFile, remove, mkdir} from "@tauri-apps/plugin-fs";

import { RightPanelShell } from "./components/rightpanel/RightPanelShell";
import { EditorHeader } from "./components/rightpanel/EditorHeader";
import LeftPanelNameCard from "./components/leftpanel/LeftPanelNameCard";
import { IconGrid, IconPlus, IconSave, IconFolderOpen, IconTrash } from "./components/icons/EwrIcons";
import { parsePromosDat, type Promo, type PromoRecord } from "./ewr/parsePromosDat";
import { parseWrestlerDat, type Worker } from "./ewr/parseWrestlerDat";
import { GIMMICKS } from "./ewr/gimmicks";
import { toArrayBuffer } from "./ewr/toArrayBuffer";
import crankyVinceLogo from "./assets/cranky_vince_logo.png";

type Props = { workspaceRoot?: string; onClose?: () => void };

type SessionEntry = {
  root: string;
  label: string;
  promotionInitials?: string;
  lastOpened: number;
  week: number;
  promotionId: number;
  promotionLabel: string;
};
type PromoContext = Promo & { initials: string; sizeRaw: number };

type BeltRecord = {
  index: number;
  name: string;
  ownerPromoId: number;
  holder1Id: number;
  holder2Id: number;
  isSinglesTitle: boolean;
  isWomensTitle: boolean;
  image: number;
};

type UniverseSnapshot = {
  saveRoot: string;
  promotions: PromoContext[];
  workers: Worker[];
  belts: BeltRecord[];
  currentDateIso?: string;
};

type ActiveCard = {
  slotId: string;
  ruleKey: string;
  title: string;
  text: string;
  kind: "serious" | "filler";
};

type HistoryItem = { week: number; slotId: string; ruleKey?: string; title: string; text: string; kind: "serious" | "filler" };

type CrankyState = {
  version: number;
  sessionName?: string;
  week: number;
  activeDeck: ActiveCard[];
  offeredCards: ActiveCard[];
  selectedPromotionId: number;
  chosenCard: ActiveCard | null;
  history: HistoryItem[];
  seriousCount: number;
  fillerCount: number;
};

type RuleContext = {
  universe: UniverseSnapshot;
  promotion: PromoContext;
};

type WorkerTier = "main" | "upper" | "mid" | "lower" | "opener" | "jobber" | "developmental";

type RuleDef = {
  key: string;
  title: string;
  eligible: (ctx: RuleContext) => boolean;
  resolve: (ctx: RuleContext) => string;
  notBefore?: string;
  notAfter?: string;
};

type FillerTemplate = {
  key: string;
  title: string;
  resolve: (ctx: RuleContext) => string;
  notBefore?: string;
  notAfter?: string;
};

type CustomRuleRequirements = {
  minActiveWorkers?: number;
  minWomen?: number;
  minMen?: number;
  minDevelopmental?: number;
  minFreeAgents?: number;
  requireWorldTitle?: boolean;
  requireMidcardTitle?: boolean;
  requireTagTitle?: boolean;
  requireWomenTitle?: boolean;
  multiplePromotions?: boolean;
};

type CustomRuleSpec = {
  key: string;
  title: string;
  text: string;
  kind?: "serious" | "filler";
  collection?: string;
  notBefore?: string;
  notAfter?: string;
  requirements?: CustomRuleRequirements;
};

type BuiltInTemplateAddonSpec = {
  key: string;
  title: string;
  kind: "serious" | "filler";
  text: string;
  notBefore?: string;
  notAfter?: string;
};

const STATE_FILE = "cranky_vince_state.json";
const SESSIONS_FILE = "cranky_vince_sessions.json";
const SESSION_STORAGE_KEY = "cranky_vince_sessions_v1";
const CUSTOM_RULES_STORAGE_KEY = "cranky_vince_rules_v1";
const CUSTOM_RULES_FILE = "cranky_vince_rules.json";
const HIDDEN_RULES_FILE = "cranky_vince_hidden_rules.json";
const HIDDEN_COLLECTIONS_FILE = "cranky_vince_hidden_collections.json";
const AI_RULE_GENERATOR_STARTER_PROMPT = `You are helping create custom rules for a feature called “Cranky Vince” in an EWR Editing Suite app.

Your job is to write NEW Cranky Vince custom rules in the same spirit as the feature:
- humorous
- board-game style challenge cards
- absurd, chaotic, and wrestling-brained
- written as direct booking mandates
- designed to disrupt a player’s booking plans
- should feel like a deranged wrestling owner forced them onto the show at the last second

IMPORTANT OUTPUT GOAL
You are NOT writing live resolved rules with actual wrestler names.
You are writing TEMPLATE RULES that use placeholder tokens so they can be dynamically filled by the app later.

WRITE RULES USING THESE PLACEHOLDERS WHEN APPROPRIATE

Promotion / company placeholders:
- {promotion} = full promotion name for the selected promotion context
- {initials} = promotion initials / short label
- {otherPromotion} = another promotion in the loaded save for cross-brand style rules

General worker placeholders:
- {worker1} = a randomly chosen active worker from the selected promotion
- {worker2} = a second randomly chosen active worker from the selected promotion
- {worker3} = a third randomly chosen active worker from the selected promotion

Gender-specific worker placeholders:
- {maleWorker} = a randomly chosen male worker from the selected promotion
- {femaleWorker} = a randomly chosen female worker from the selected promotion
- {maleWorker1} = first randomly chosen male worker from the selected promotion
- {maleWorker2} = second randomly chosen male worker from the selected promotion
- {maleWorker3} = third randomly chosen male worker from the selected promotion
- {femaleWorker1} = first randomly chosen female worker from the selected promotion
- {femaleWorker2} = second randomly chosen female worker from the selected promotion
- {femaleWorker3} = third randomly chosen female worker from the selected promotion

Worker-status placeholders:
- {topWorker} = one of the most over workers in the selected promotion context
- {leastOverWorker} = the least over active worker in the selected promotion
- {oldestWorker} = the oldest active worker in the selected promotion

Free agent / developmental placeholders:
- {freeAgent1} = a randomly chosen available free agent
- {freeAgent2} = a second randomly chosen available free agent
- {freeAgent3} = a third randomly chosen available free agent
- {developmental1} = a randomly chosen developmental worker from the selected promotion, if one exists
- {developmental2} = a second randomly chosen developmental worker from the selected promotion, if one exists

Title placeholders:
- {worldTitle} = the promotion’s highest prestige world championship
- {midcardTitle} = a midcard singles title from the selected promotion
- {tagTitle} = a tag team championship from the selected promotion
- {womensTitle} = a women’s championship from the selected promotion

WRITING RULES
Rules should usually be one clean sentence.
They should read like challenge cards or punishment cards.
They should be immediately understandable by a wrestling game player.
They should sound like something a chaotic, short-sighted, egotistical wrestling promoter would demand.

STYLE RULES
- Keep tone witty, sarcastic, and playful
- Do not explain the joke
- Do not write lore or backstory unless the rule itself needs one sentence of setup
- Do not use actual wrestler names unless specifically asked to write examples with real names
- Do not output resolved examples unless explicitly requested
- Prefer placeholder-driven templates
- Feud rules should usually be male/male or female/female unless the concept specifically calls for something else
- Relationship rules should usually be male/female unless explicitly asked otherwise
- Do not make every rule about titles
- Do not make every rule about gimmick changes
- Vary the concepts heavily so the deck feels replayable

WHAT MAKES A GOOD RULE
A good rule:
- is easy to understand
- clearly tells the user what must happen
- is disruptive to normal booking
- is funny or ridiculous
- can plausibly be interpreted in EWR gameplay terms
- uses placeholders naturally

WHAT TO AVOID
- generic filler like “{worker1} must deal with the fallout from...”
- vague nonsense without a concrete action
- using placeholders awkwardly
- repeating the same joke structure over and over
- writing ten versions of the same card with minor wording changes
- overly long multi-paragraph rules
- requiring things EWR cannot reasonably represent unless the absurdity is still usable as a roleplay challenge

OUTPUT FORMAT
For each rule, output:
1. Title
2. Kind
3. Not Before
4. Not After
5. Template Text

Use this exact format:

Title: <rule title>
Kind: <serious or filler>
Not Before: <YYYY-MM-DD or blank>
Not After: <YYYY-MM-DD or blank>
Template: <placeholder-based rule text>

DATE LIMIT GUIDANCE
- Use YYYY-MM-DD only.
- Leave Not Before blank if the rule can appear in any era before the limit.
- Leave Not After blank if the rule can appear in any era after the limit.
- Leave both blank if the rule can appear at any time in history.
- Only use era limits when the concept clearly depends on a time period. Do not invent random date limits.

When asked for multiple rules, separate them clearly.

KIND GUIDANCE
- serious = more directly game-usable booking mandates, match/title/roster/feud/angle directives
- filler = chaos, comedy, gimmick pivots, ridiculous segments, brand nonsense, production disasters, surreal wrestling-TV stupidity

EXAMPLES OF GOOD OUTPUT

Title: Commentary in Crisis
Kind: serious
Not Before:
Not After:
Template: The commentary team are forced into a match with the reigning {worldTitle} holder to defend their jobs.

Title: Completely Realistic Romance
Kind: serious
Not Before:
Not After:
Template: {femaleWorker1} and {maleWorker1} must begin a REALISTIC, deeply melodramatic relationship angle.

Title: Birthday Segment
Kind: filler
Not Before:
Not After:
Template: {worker1} must be forced into a painfully long birthday or celebration segment.

Title: VHS Tie-In
Kind: filler
Not Before:
Not After: 1999-12-31
Template: {worker1} must hype a brand new VHS release as if it is a culture-shifting event.

Title: Winner Takes More
Kind: serious
Not Before:
Not After:
Template: The main event is {worldTitle} versus {midcardTitle} with one clear winner.

Title: Social Media Disaster
Kind: serious
Not Before: 2005-01-01
Not After:
Template: A major feud must now spiral through social media posts, public arguments, and management damage control.

TASK
Generate custom Cranky Vince rules that are varied, reusable, funny, and written as placeholder-based templates for the app.

Unless otherwise specified, generate 25 rules with a healthy mix of serious and filler.`;
const STATE_VERSION = 2;
const BACK_GLOB = import.meta.glob("./assets/playing_cards/*.{png,jpg,jpeg}", { eager: true, import: "default" }) as Record<string, string>;
function _cardDisplayName(slotId: string) {
  const raw = String(slotId ?? "").trim().toLowerCase();
  if (!raw) return "Card";
  const parts = raw.split("_of_");
  if (parts.length !== 2) return raw.replace(/_/g, " ");
  const rankMap: Record<string, string> = { ace: "Ace", jack: "Jack", queen: "Queen", king: "King" };
  const suitMap: Record<string, string> = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
  const rank = rankMap[parts[0]] || parts[0].toUpperCase();
  const suit = suitMap[parts[1]] || parts[1];
  return `${rank} ${suit}`;
}
void _cardDisplayName;

const CARD_BACK = Object.entries(BACK_GLOB).find(([path]) => /card_back\.(png|jpg|jpeg)$/i.test(path))?.[1] ?? "";
const CARD_FACE_ORDER = [
  "ace_of_clubs","2_of_clubs","3_of_clubs","4_of_clubs","5_of_clubs","6_of_clubs","7_of_clubs","8_of_clubs","9_of_clubs","10_of_clubs","jack_of_clubs","queen_of_clubs","king_of_clubs",
  "ace_of_diamonds","2_of_diamonds","3_of_diamonds","4_of_diamonds","5_of_diamonds","6_of_diamonds","7_of_diamonds","8_of_diamonds","9_of_diamonds","10_of_diamonds","jack_of_diamonds","queen_of_diamonds","king_of_diamonds",
  "ace_of_hearts","2_of_hearts","3_of_hearts","4_of_hearts","5_of_hearts","6_of_hearts","7_of_hearts","8_of_hearts","9_of_hearts","10_of_hearts","jack_of_hearts","queen_of_hearts","king_of_hearts",
  "ace_of_spades","2_of_spades","3_of_spades","4_of_spades","5_of_spades","6_of_spades","7_of_spades","8_of_spades","9_of_spades","10_of_spades","jack_of_spades","queen_of_spades","king_of_spades",
] as const;
const CARD_FACE_MAP = Object.fromEntries(
  CARD_FACE_ORDER.map((name) => {
    const match = Object.entries(BACK_GLOB).find(([path]) =>
      new RegExp(`/${name}\.(png|jpg|jpeg)$`, "i").test(path)
    );
    return [name, match?.[1] ?? ""];
  })
) as Record<string, string>;

let CUSTOM_RULE_PACK: { serious: CustomRuleSpec[]; filler: CustomRuleSpec[] } = { serious: [], filler: [] };
let HIDDEN_RULE_KEYS = new Set<string>();
let HIDDEN_COLLECTIONS = new Set<string>();

const GAMEINFO_CURRENT_DATE_OFFSET = 0x183;

function readF64LE(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getFloat64(offset, true);
}

function oleDateToIso(value: number) {
  if (!Number.isFinite(value)) return "";
  const baseUtcMs = Date.UTC(1899, 11, 30, 0, 0, 0, 0);
  const ms = baseUtcMs + value * 86400000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeOptionalIsoDate(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`Date limits must use YYYY-MM-DD. Invalid value: ${raw}`);
  const dt = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid calendar date: ${raw}`);
  return raw;
}

function validateRuleDateWindow(notBefore?: string, notAfter?: string) {
  if (notBefore && notAfter && notAfter < notBefore) {
    throw new Error(`Not After cannot be earlier than Not Before (${notBefore} > ${notAfter}).`);
  }
}

function parseGameInfoCurrentDate(bytes: Uint8Array) {
  if (bytes.byteLength < GAMEINFO_CURRENT_DATE_OFFSET + 8) return "";
  return oleDateToIso(readF64LE(bytes, GAMEINFO_CURRENT_DATE_OFFSET));
}

function isRuleDateEligible(rule: { notBefore?: string; notAfter?: string }, currentDateIso?: string) {
  const current = String(currentDateIso || "").trim();
  if (!current) return true;
  if (rule.notBefore && current < rule.notBefore) return false;
  if (rule.notAfter && current > rule.notAfter) return false;
  return true;
}

function describeRuleEra(rule: { notBefore?: string; notAfter?: string } | null | undefined) {
  const notBefore = String(rule?.notBefore || "").trim();
  const notAfter = String(rule?.notAfter || "").trim();
  if (!notBefore && !notAfter) return "Any time";
  if (notBefore && notAfter) return `${notBefore} to ${notAfter}`;
  if (notBefore) return `From ${notBefore}`;
  return `Until ${notAfter}`;
}


function parseLabeledRuleText(raw: string): CustomRuleSpec | null {
  const text = String(raw || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const lines = text.split("\n");
  const values: Record<string, string> = {};
  let templateIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const match = line.match(/^([A-Za-z][A-Za-z\s]*):\s*(.*)$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    const value = match[2] ?? "";
    values[label] = value;
    if (label === "template" || label === "template text" || label === "rule text") {
      templateIndex = i;
      break;
    }
  }
  if (!('title' in values) && !('template' in values) && !('template text' in values) && !('rule text' in values)) {
    return null;
  }
  let template = "";
  if (templateIndex >= 0) {
    const first = lines[templateIndex].replace(/^([A-Za-z][A-Za-z\s]*):\s*/, "");
    template = [first, ...lines.slice(templateIndex + 1)].join("\n").trim();
  }
  const title = String(values["title"] || "").trim();
  const kindRaw = String(values["kind"] || "serious").trim().toLowerCase();
  const kind = kindRaw === "filler" ? "filler" : "serious";
  const notBefore = String(values["not before"] || "").trim();
  const notAfter = String(values["not after"] || "").trim();
  const collection = String(values["collection"] || "").trim();
  const rawKey = String(values["key"] || "").trim();
  const baseKey = rawKey || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom_new_rule";
  return {
    key: baseKey,
    title: title || "New Custom Rule",
    kind,
    text: template || "Write your custom Cranky Vince rule text here.",
    collection,
    notBefore,
    notAfter,
    requirements: {},
  };
}

function parseEditorRuleInput(raw: string): CustomRuleSpec | null {
  const source = String(raw || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source || '{"rules":[]}');
    const rows = Array.isArray(parsed?.rules) ? parsed.rules : Array.isArray(parsed) ? parsed : [];
    const first = rows[0] ?? {};
    return {
      key: String(first?.key ?? "custom_new_rule"),
      title: String(first?.title ?? "New Custom Rule"),
      kind: String(first?.kind ?? "serious").trim().toLowerCase() === "filler" ? "filler" : "serious",
      text: typeof first?.text === "string" ? first.text : "Write your custom Cranky Vince rule text here.",
      collection: typeof first?.collection === "string" ? first.collection : "",
      notBefore: typeof first?.notBefore === "string" ? first.notBefore : "",
      notAfter: typeof first?.notAfter === "string" ? first.notAfter : "",
      requirements: typeof first?.requirements === "object" && first?.requirements ? first.requirements : {},
    };
  } catch {
    return parseLabeledRuleText(source);
  }
}

function normalizeCustomRulePack(raw: any) {
  const rows = Array.isArray(raw?.rules) ? raw.rules : Array.isArray(raw) ? raw : [];
  const serious: CustomRuleSpec[] = [];
  const filler: CustomRuleSpec[] = [];
  rows.forEach((row: any, idx: number) => {
    const key = String(row?.key ?? `custom_rule_${idx + 1}`).trim();
    const title = String(row?.title ?? "").trim();
    const text = String(row?.text ?? "").trim();
    const kind = String(row?.kind ?? "serious").trim().toLowerCase() === "filler" ? "filler" : "serious";
    const collection = String(row?.collection ?? "").trim();
    const notBefore = normalizeOptionalIsoDate(row?.notBefore);
    const notAfter = normalizeOptionalIsoDate(row?.notAfter);
    validateRuleDateWindow(notBefore, notAfter);
    if (!title || !text) return;
    const spec: CustomRuleSpec = {
      key,
      title,
      text,
      kind,
      collection,
      notBefore,
      notAfter,
      requirements: typeof row?.requirements === "object" && row?.requirements ? row.requirements : undefined,
    };
    if (kind === "filler") filler.push(spec);
    else serious.push(spec);
  });
  return { serious, filler };
}


const BELT_RECORD_SIZE = 457;
const POSITION_DEVELOPMENTAL = 7;
const ACTIVE_WRESTLING_POSITIONS = new Set([1, 2, 3, 4, 5, 6, 7]);

function readU16LE(bytes: Uint8Array, offset: number) { return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8); }
function readAscii(bytes: Uint8Array, offset: number, length: number) {
  const slice = bytes.slice(offset, offset + length);
  const zero = slice.indexOf(0);
  const clean = zero >= 0 ? slice.slice(0, zero) : slice;
  return new TextDecoder("latin1").decode(clean).replace(/\u0000/g, "").trimEnd().trim();
}
function textFile(bytes: Uint8Array) { return new TextDecoder("utf-8").decode(bytes); }
function encodeText(value: string) { return new TextEncoder().encode(value); }
function shuffle<T>(items: T[]): T[] { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
function randomFrom<T>(items: T[]): T | null { return items.length ? items[Math.floor(Math.random() * items.length)] ?? null : null; }
function randomMany<T>(items: T[], count: number): T[] { return shuffle(items).slice(0, count); }
function uniqueWorkers(items: Worker[]) { const seen = new Set<number>(); return items.filter((w) => !seen.has(Number(w.id)) && seen.add(Number(w.id))); }

function parseBeltDat(bytes: Uint8Array): BeltRecord[] {
  if (!bytes.length || bytes.length % BELT_RECORD_SIZE !== 0) return [];
  const out: BeltRecord[] = [];
  for (let i = 0; i < bytes.length / BELT_RECORD_SIZE; i++) {
    const base = i * BELT_RECORD_SIZE;
    out.push({
      index: i,
      name: readAscii(bytes, base + 1, 30) || `(Unnamed Belt ${i})`,
      ownerPromoId: readU16LE(bytes, base + 33),
      holder1Id: readU16LE(bytes, base + 35),
      holder2Id: readU16LE(bytes, base + 37),
      isSinglesTitle: readU16LE(bytes, base + 31) === 0xffff,
      isWomensTitle: readU16LE(bytes, base + 41) === 0xffff,
      image: readU16LE(bytes, base + 43),
    });
  }
  return out;
}

function workerName(worker?: Worker | null) { return String((worker as any)?.fullName ?? "").trim() || "A wrestler"; }
function beltName(belt?: BeltRecord | null) {
  const raw = String(belt?.name || "").trim();
  if (!raw) return "a championship";
  return /\b(title|championship)\b/i.test(raw) ? raw : `${raw} Championship`;
}
function promoById(promotions: PromoContext[], id: number) { return promotions.find((p) => Number(p.id) === Number(id)) ?? null; }
function promotionInitials(promotions: PromoContext[], id: number) { return promoById(promotions, id)?.initials || promoById(promotions, id)?.shortName || promoById(promotions, id)?.name || "Promotion"; }
function otherPromotion(promotions: PromoContext[], id: number) { return randomFrom(promotions.filter((p) => Number(p.id) !== Number(id))); }
function workerPromoIds(worker: Worker) { return [Number((worker as any).employer1PromoId || 0), Number((worker as any).employer2PromoId || 0), Number((worker as any).employer3PromoId || 0)].filter(Boolean); }
function workerPositions(worker: Worker) { return [Number((worker as any).employer1PositionRaw || 0), Number((worker as any).employer2PositionRaw || 0), Number((worker as any).employer3PositionRaw || 0)]; }
function worksForPromotion(worker: Worker, promoId: number) { return workerPromoIds(worker).includes(Number(promoId)); }
function primaryPositionForPromotion(worker: Worker, promoId: number) {
  const ids = workerPromoIds(worker);
  const pos = workerPositions(worker);
  for (let i = 0; i < ids.length; i++) if (Number(ids[i]) === Number(promoId)) return Number(pos[i] || 0);
  return 0;
}
function activeWorkersForPromotion(workers: Worker[], promoId: number) {
  return uniqueWorkers(workers.filter((w) => worksForPromotion(w, promoId) && ACTIVE_WRESTLING_POSITIONS.has(primaryPositionForPromotion(w, promoId))));
}
function developmentalWorkers(workers: Worker[], promoId: number) {
  return activeWorkersForPromotion(workers, promoId).filter((w) => primaryPositionForPromotion(w, promoId) === POSITION_DEVELOPMENTAL);
}
function womenWorkers(workers: Worker[], promoId: number) { return activeWorkersForPromotion(workers, promoId).filter((w) => Number((w as any).genderRaw || 0) !== 65535); }
function menWorkers(workers: Worker[], promoId: number) { return activeWorkersForPromotion(workers, promoId).filter((w) => Number((w as any).genderRaw || 0) === 65535); }
function freeAgents(workers: Worker[]) {
  return uniqueWorkers(workers.filter((w) => {
    const employed = workerPromoIds(w).length > 0;
    const contractCode = String((w as any).contractCode ?? "").toUpperCase();
    return !employed && !contractCode.includes("W") && !contractCode.includes("J");
  }));
}
function sortByOverness(workers: Worker[], desc = true) { return [...workers].sort((a, b) => desc ? Number((b as any).overnessRaw || 0) - Number((a as any).overnessRaw || 0) : Number((a as any).overnessRaw || 0) - Number((b as any).overnessRaw || 0)); }
function topWorker(workers: Worker[]) { return sortByOverness(workers, true)[0] ?? null; }
function topFiveWorkers(workers: Worker[]) { return sortByOverness(workers, true).slice(0, 5); }
function bottomWorker(workers: Worker[]) { return sortByOverness(workers, false)[0] ?? null; }
function oldestWorker(workers: Worker[]) { return [...workers].sort((a, b) => Number((b as any).ageRaw || 0) - Number((a as any).ageRaw || 0))[0] ?? null; }
function workerPair(workers: Worker[]) { const picks = randomMany(workers, 2); return [picks[0] ?? null, picks[1] ?? null] as const; }
function workerGroup(workers: Worker[], count: number) { return randomMany(workers, count).map(workerName); }
function maleFemalePair(ctx: RuleContext) {
  const men = menWorkers(ctx.universe.workers, ctx.promotion.id);
  const women = womenWorkers(ctx.universe.workers, ctx.promotion.id);
  const male = randomFrom(men);
  const female = randomFrom(women);
  if (Number((male as any)?.genderRaw || 0) !== 65535 || Number((female as any)?.genderRaw || 0) === 65535) return [null, null] as const;
  return [male, female] as const;
}

function titleBeltsForPromotion(belts: BeltRecord[], promoId: number) { return belts.filter((b) => Number(b.ownerPromoId) === Number(promoId)); }
function singlesBeltsForPromotion(belts: BeltRecord[], promoId: number) { return titleBeltsForPromotion(belts, promoId).filter((b) => b.isSinglesTitle); }
function tagBeltsForPromotion(belts: BeltRecord[], promoId: number) { return titleBeltsForPromotion(belts, promoId).filter((b) => !b.isSinglesTitle); }
function worldTitleForPromotion(belts: BeltRecord[], promoId: number) {
  const options = singlesBeltsForPromotion(belts, promoId).filter((b) => !b.isWomensTitle);
  return [...options].sort((a, b) => b.image - a.image)[0] ?? null;
}
function womenTitleForPromotion(belts: BeltRecord[], promoId: number) {
  return [...singlesBeltsForPromotion(belts, promoId).filter((b) => b.isWomensTitle)].sort((a, b) => b.image - a.image)[0] ?? null;
}
function midcardTitlesForPromotion(belts: BeltRecord[], promoId: number) {
  const world = worldTitleForPromotion(belts, promoId);
  return singlesBeltsForPromotion(belts, promoId).filter((b) => !b.isWomensTitle && b.index !== world?.index).sort((a, b) => b.image - a.image);
}
function midcardTitleForPromotion(belts: BeltRecord[], promoId: number) { return midcardTitlesForPromotion(belts, promoId)[0] ?? null; }
function tagTitleForPromotion(belts: BeltRecord[], promoId: number) { return [...tagBeltsForPromotion(belts, promoId)].sort((a, b) => b.image - a.image)[0] ?? null; }

function tierThresholds(sizeRaw: number) {
  switch (Number(sizeRaw)) {
    case 5: return { main: [91, 100], upper: [81, 90], mid: [61, 80], lower: [41, 60], opener: [21, 40], jobber: [0, 20] };
    case 4: return { main: [81, 100], upper: [71, 80], mid: [56, 70], lower: [41, 55], opener: [21, 40], jobber: [0, 20] };
    case 3: return { main: [66, 100], upper: [51, 65], mid: [41, 50], lower: [21, 40], opener: [11, 20], jobber: [0, 10] };
    case 2: return { main: [56, 70], upper: [46, 55], mid: [36, 45], lower: [21, 35], opener: [11, 20], jobber: [0, 10] };
    case 1: return { main: [36, 50], upper: [21, 35], mid: [11, 20], lower: [6, 10], opener: [0, 5], jobber: [0, 5] };
    default: return { main: [21, 30], upper: [11, 20], mid: [6, 10], lower: [0, 5], opener: [0, 5], jobber: [0, 5] };
  }
}
function tierOfWorker(worker: Worker, sizeRaw: number): WorkerTier {
  const o = Number((worker as any).overnessRaw || 0);
  const t = tierThresholds(sizeRaw);
  if (o >= t.main[0]) return "main";
  if (o >= t.upper[0]) return "upper";
  if (o >= t.mid[0]) return "mid";
  if (o >= t.lower[0]) return "lower";
  if (o >= t.opener[0]) return "opener";
  return "jobber";
}
function workersByTier(ctx: RuleContext, tier: WorkerTier) {
  const pool = tier === "developmental" ? developmentalWorkers(ctx.universe.workers, ctx.promotion.id) : activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id);
  if (tier === "developmental") return pool;
  return pool.filter((w) => tierOfWorker(w, ctx.promotion.sizeRaw) === tier);
}
function atLeast<T>(items: T[], count: number) { return items.length >= count; }

function placeholderMap(ctx: RuleContext) {
  const active = activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id);
  const free = freeAgents(ctx.universe.workers);
  const workerA = randomFrom(active);
  const workerB = randomFrom(active.filter((w) => Number((w as any).id || 0) !== Number((workerA as any)?.id || 0)));
  const workerC = randomFrom(active.filter((w) => ![Number((workerA as any)?.id || 0), Number((workerB as any)?.id || 0)].includes(Number((w as any).id || 0))));
  const world = worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id);
  const mid = midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id);
  const tag = tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id);
  const women = womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id);
  const malePool = menWorkers(ctx.universe.workers, ctx.promotion.id);
  const femalePool = womenWorkers(ctx.universe.workers, ctx.promotion.id);
  const maleA = randomFrom(malePool);
  const maleB = randomFrom(malePool.filter((w) => Number((w as any).id || 0) != Number((maleA as any)?.id || 0)));
  const maleC = randomFrom(malePool.filter((w) => ![Number((maleA as any)?.id || 0), Number((maleB as any)?.id || 0)].includes(Number((w as any).id || 0))));
  const femaleA = randomFrom(femalePool);
  const femaleB = randomFrom(femalePool.filter((w) => Number((w as any).id || 0) != Number((femaleA as any)?.id || 0)));
  const femaleC = randomFrom(femalePool.filter((w) => ![Number((femaleA as any)?.id || 0), Number((femaleB as any)?.id || 0)].includes(Number((w as any).id || 0))));
  return {
    promotion: ctx.promotion.name,
    initials: ctx.promotion.initials,
    worker1: workerName(workerA),
    worker2: workerName(workerB),
    worker3: workerName(workerC),
    maleWorker: workerName(maleA),
    femaleWorker: workerName(femaleA),
    maleWorker1: workerName(maleA),
    maleWorker2: workerName(maleB),
    maleWorker3: workerName(maleC),
    femaleWorker1: workerName(femaleA),
    femaleWorker2: workerName(femaleB),
    femaleWorker3: workerName(femaleC),
    topWorker: workerName(topWorker(active)),
    leastOverWorker: workerName(bottomWorker(active)),
    oldestWorker: workerName(oldestWorker(active)),
    freeAgent1: workerName(free[0]),
    freeAgent2: workerName(free[1]),
    freeAgent3: workerName(free[2]),
    developmental1: workerName(randomFrom(developmentalWorkers(ctx.universe.workers, ctx.promotion.id))),
    developmental2: workerName(randomFrom(developmentalWorkers(ctx.universe.workers, ctx.promotion.id))),
    worldTitle: beltName(world),
    midcardTitle: beltName(mid),
    tagTitle: beltName(tag),
    womensTitle: beltName(women),
    otherPromotion: otherPromotion(ctx.universe.promotions, ctx.promotion.id)?.name || "the other brand",
  } as Record<string, string>;
}

function resolveTemplateText(template: string, ctx: RuleContext) {
  const map = placeholderMap(ctx);
  return String(template ?? "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => map[String(key)] ?? `{${String(key)}}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholderizeResolvedText(text: string, ctx: RuleContext) {
  const source = String(text || "").trim();
  if (!source) return "";
  const map = placeholderMap(ctx);
  const ordered = Object.entries(map)
    .filter(([, value]) => String(value || "").trim())
    .sort((a, b) => String(b[1]).length - String(a[1]).length);
  let result = source;
  for (const [token, value] of ordered) {
    const escaped = escapeRegExp(String(value));
    const exactPattern = new RegExp(escaped, "g");
    const wordPattern = new RegExp(`${escaped}`, "g");
    result = result.replace(exactPattern, `{${token}}`);
    result = result.replace(wordPattern, `{${token}}`);
  }
  return result;
}

function customRuleEligible(spec: CustomRuleSpec, ctx: RuleContext) {
  const req = spec.requirements || {};
  const active = activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id);
  if (Number(req.minActiveWorkers || 0) > active.length) return false;
  if (Number(req.minWomen || 0) > womenWorkers(ctx.universe.workers, ctx.promotion.id).length) return false;
  if (Number(req.minMen || 0) > menWorkers(ctx.universe.workers, ctx.promotion.id).length) return false;
  if (Number(req.minDevelopmental || 0) > developmentalWorkers(ctx.universe.workers, ctx.promotion.id).length) return false;
  if (Number(req.minFreeAgents || 0) > freeAgents(ctx.universe.workers).length) return false;
  if (req.requireWorldTitle && !worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id)) return false;
  if (req.requireMidcardTitle && !midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id)) return false;
  if (req.requireTagTitle && !tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id)) return false;
  if (req.requireWomenTitle && !womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id)) return false;
  if (req.multiplePromotions && ctx.universe.promotions.length < 2) return false;
  return true;
}

function createSeriousRuleLibrary(ctx?: RuleContext): RuleDef[] {
  const base: RuleDef[] = [
    { key: "time_traveler_gimmick", title: "Time Traveler", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must debut a brand new time-traveler gimmick on the next ${ctx.promotion.initials} show.` },
    { key: "brand_jump", title: "Brand Jumper", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1) && ctx.universe.promotions.length > 1, resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must spend the next month teasing a jump from ${ctx.promotion.name} to ${otherPromotion(ctx.universe.promotions, ctx.promotion.id)?.name || "the other brand"}, even though management has no real intention of letting it happen.` },
    { key: "top_losing_streak", title: "Hero to Zero", eligible: (ctx) => atLeast(topFiveWorkers(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)), 1), resolve: (ctx) => `${workerName(randomFrom(topFiveWorkers(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id))))} must go on a losing streak despite being in the top five most popular stars in ${ctx.promotion.initials}.` },
    { key: "women_only_show", title: "Ladies Night", eligible: (ctx) => atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 4), resolve: (ctx) => `Your next ${ctx.promotion.initials} show is an all-women special. No men allowed in the ring.` },
    { key: "all_titles_change", title: "Night of Upheaval", eligible: (ctx) => titleBeltsForPromotion(ctx.universe.belts, ctx.promotion.id).length > 0, resolve: (ctx) => `Every active ${ctx.promotion.initials} championship must change hands on the same night.` },
    { key: "title_vs_title", title: "Winner Takes More", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `The main event is ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} versus ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} with one clear winner.` },
    { key: "least_over_world_title", title: "Worst Idea Wins", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(bottomWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must end this challenge as the reigning ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))}.` },
    { key: "oldest_world_title", title: "One Last Run", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(oldestWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must capture ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and hold it for at least six months.` },
    { key: "least_vs_most", title: "Impossible Feud", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `${workerName(bottomWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must feud with ${workerName(topWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))}.` },
    { key: "five_masks", title: "LUCHA!", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 5), resolve: (ctx) => `At least five established ${ctx.promotion.initials} workers must don masks immediately.` },
    { key: "travel_issues", title: "Travel Nightmare", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 5), resolve: (ctx) => `Travel has collapsed. Roughly 60% of the ${ctx.promotion.initials} roster is stuck abroad and cannot appear on the next show.` },
    { key: "all_cage", title: "Steel Everywhere", eligible: () => true, resolve: (ctx) => `Every match on your next ${ctx.promotion.initials} show must be contested inside a cage.` },
    { key: "double_turn", title: "Double Cross", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b]=workerPair(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)); return `${workerName(a)} and ${workerName(b)} must both flip alignment on the same show, even if it makes no sense.`; } },
    { key: "heat_from_management", title: "Heat From Management", eligible: (ctx) => atLeast([...workersByTier(ctx, "main"), ...workersByTier(ctx, "upper")], 1) && atLeast([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")], 1), resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "main"), ...workersByTier(ctx, "upper")]))} must job to ${workerName(randomFrom([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")]))} after annoying Vince.` },
    { key: "can_they_coexist", title: "Can They Co-Exist?", eligible: (ctx) => !!tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(workersByTier(ctx, "main"), 1) && atLeast(workersByTier(ctx, "upper"), 1), resolve: (ctx) => `${workerName(randomFrom(workersByTier(ctx, "main")))} and ${workerName(randomFrom(workersByTier(ctx, "upper")))} must become reluctant tag champions for at least two months.` },
    { key: "night_of_developmental", title: "Night of Developmental", eligible: (ctx) => atLeast(developmentalWorkers(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `Developmental talent must headline the next ${ctx.promotion.initials} show and defeat established upper-level names before vanishing back into obscurity.` },
    { key: "free_agents_group", title: "Market Raid", eligible: (ctx) => atLeast(freeAgents(ctx.universe.workers), 3), resolve: (ctx) => `${workerGroup(freeAgents(ctx.universe.workers), 3).join(", ")} must be signed and debuted as a new group.` },
    { key: "developmental_upset", title: "Fresh Meat Surprise", eligible: (ctx) => atLeast(developmentalWorkers(ctx.universe.workers, ctx.promotion.id), 1) && atLeast(workersByTier(ctx, "main"), 1), resolve: (ctx) => `${workerName(randomFrom(developmentalWorkers(ctx.universe.workers, ctx.promotion.id)))} must debut and defeat ${workerName(randomFrom(workersByTier(ctx, "main")))} immediately.` },
    { key: "magician_title_retire", title: "Now You See It", eligible: (ctx) => atLeast(developmentalWorkers(ctx.universe.workers, ctx.promotion.id), 1) && !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${workerName(randomFrom(developmentalWorkers(ctx.universe.workers, ctx.promotion.id)))} debuts as a magician and makes ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} disappear for good.` },
    { key: "commentary_match", title: "Commentary in Crisis", eligible: (ctx) => titleBeltsForPromotion(ctx.universe.belts, ctx.promotion.id).length > 0, resolve: (ctx) => `The commentary team are forced into a match with the reigning ${beltName(randomFrom(titleBeltsForPromotion(ctx.universe.belts, ctx.promotion.id)))} holder to defend their jobs.` },
    { key: "midcard_title_shared", title: "Joint Custody", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "lower")], 2), resolve: (ctx) => { const picks = workerGroup([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "lower")], 2); return `${picks[0]} and ${picks[1]} must jointly hold ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and defend it together.`; } },
    { key: "women_tag_challenge", title: "Four Words", eligible: (ctx) => atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 4), resolve: () => `Women's. Tag. Team. Championship. Figure it out.` },
    { key: "heavyweight_cruiser", title: "Weight Is a Construct", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(menWorkers(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `A super-heavyweight must win ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and everyone must act like the scales were perfectly normal.` },
    { key: "women_world_swap", title: "Division Disturbance", eligible: (ctx) => !!womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${beltName(womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} become the center of one deeply misguided cross-division angle.` },
    { key: "pet_gimmick", title: "Pet Project", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must introduce a new pet or animal as an essential part of the gimmick.` },
    { key: "realistic_relationship", title: "Completely Realistic Romance", eligible: (ctx) => atLeast(menWorkers(ctx.universe.workers, ctx.promotion.id), 1) && atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => { const [a,b]=maleFemalePair(ctx); return a && b ? `${workerName(a)} and ${workerName(b)} must begin a REALISTIC, deeply melodramatic relationship angle.` : `Management demands a painfully melodramatic male/female relationship angle this week.`; } },
    { key: "stable_resurrection", title: "Resurrection", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3), resolve: () => `An old stable must be resurrected. Roll a die: Ministry, Corporation, Four Horsemen, Dungeon of Doom, DX, or Nation.` },
    { key: "retirement_loss", title: "Last Chance", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(oldestWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must declare retirement after one more loss, and that loss will happen.` },
    { key: "all_multiman", title: "More Wrestlers = More Ratings", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 8), resolve: (ctx) => `Your next ${ctx.promotion.initials} show must be wall-to-wall multi-person chaos so as many workers as possible can wrestle.` },
    { key: "old_timer_guest_ref", title: "Live, Via Satellite!", eligible: (ctx) => atLeast([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "upper")], 1), resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "upper")]))} must feud with an old-timer for a month before the blowoff becomes a guest-referee match.` },
    { key: "title_hot_potato", title: "Hot Potato", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} must change hands on consecutive shows.` },
    { key: "oldest_vs_cruiser", title: "Too Old, Too Fast", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(oldestWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must target ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and have their painfully slow offense treated like lightning.` },
    { key: "fan_contract", title: "Barrier Breach", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `A fan must jump the barrier, attack ${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))}, and be rewarded with a contract.` },
    { key: "movie_synergy", title: "Corporate Synergy", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `The next ${ctx.promotion.initials} show must revolve around a fake blockbuster starring ${workerName(topWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))}.` },
    { key: "unlikely_tag", title: "Instant Team", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b]=workerPair(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)); return `${workerName(a)} and ${workerName(b)} must immediately become a tag team after colliding last week.`; } },
    { key: "production_truck", title: "Truck Trouble", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must cause havoc in the production truck.` },
    { key: "title_race_to_bottom", title: "Prestige Crash", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")], 1), resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")]))} must capture ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))}.` },
    { key: "world_musical", title: "The Musical", eligible: () => true, resolve: (ctx) => `${ctx.promotion.initials}: The Musical. Your next show must lean into it shamelessly.` },
    { key: "hell_in_cell", title: "Hell In A Cell", eligible: () => true, resolve: () => `There must be a Hell In A Cell match on the show, and it must have a clean finish.` },
    { key: "weekly_rerun_feud", title: "No Finish Loop", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b]=workerPair(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)); return `${workerName(a)} and ${workerName(b)} must wrestle each other repeatedly for two months without either scoring one decisive win.`; } },
  ];
  const custom: RuleDef[] = ctx ? CUSTOM_RULE_PACK.serious.filter((spec) => !HIDDEN_COLLECTIONS.has(String(spec.collection || "").trim() || "Ungrouped")).map((spec) => ({
    key: spec.key,
    title: spec.title,
    eligible: (inner) => customRuleEligible(spec, inner),
    resolve: (inner) => resolveTemplateText(spec.text, inner),
    notBefore: spec.notBefore,
    notAfter: spec.notAfter,
  })) : [];
  return [...base, ...EXTRA_SERIOUS_RULES, ...BUILT_IN_TEMPLATE_SERIOUS_RULES, ...custom];
}


const BUILT_IN_TEMPLATE_ADDONS: BuiltInTemplateAddonSpec[] = [
  { key: "addon_aol_keyword_panic", title: "AOL Keyword: PANIC", kind: "filler", text: "{worker1} must spend an entire three-minute promo teaching the audience how to use an AOL Keyword to find the {initials} chat room.", notBefore: "1995-01-01", notAfter: "1999-12-31" },
  { key: "addon_the_ultimate_pay_per_view_prize", title: "The Ultimate Pay-Per-View Prize", kind: "serious", text: "The winner of the {worldTitle} match tonight also wins a brand new 1993 Ford Explorer and a year's supply of Slim Jims.", notBefore: "1990-01-01", notAfter: "1995-12-31" },
  { key: "addon_dial_up_disaster", title: "Dial-Up Disaster", kind: "filler", text: "{topWorker} must be interrupted by the sound of a 56k modem handshake, signaling that {worker1} is \"hacking\" the TitanTron.", notBefore: "1996-01-01", notAfter: "1999-12-31" },
  { key: "addon_beeper_blunder", title: "Beeper Blunder", kind: "filler", text: "{maleWorker1} must stop his match mid-way to check his pager and immediately sprint to the backstage area to find a payphone.", notBefore: "1990-01-01", notAfter: "1997-12-31" },
  { key: "addon_blockbuster_expiration", title: "Blockbuster Expiration", kind: "serious", text: "{worker1} must lose tonight's match because they are distracted by the realization that they left a rented copy of \"Ghost\" in their VCR at home.", notBefore: "1990-01-01", notAfter: "1999-12-31" },
  { key: "addon_the_grunge_transformation", title: "The Grunge Transformation", kind: "filler", text: "{maleWorker1} must stop showering, put on a flannel shirt, and cut a promo about how \"everything is meaningless\" to appeal to the Seattle market.", notBefore: "1991-01-01", notAfter: "1994-12-31" },
  { key: "addon_tamagotchi_tragedy", title: "Tamagotchi Tragedy", kind: "filler", text: "{femaleWorker1} must be found weeping backstage because {femaleWorker2} forgot to feed her digital pet during the previous segment.", notBefore: "1996-01-01", notAfter: "1998-12-31" },
  { key: "addon_extreme_soda_synergy", title: "Extreme Soda Synergy", kind: "filler", text: "{worker1} must be repackaged with a neon-colored gimmick entirely themed around a radical new citrus-flavored \"X-Treme\" soda.", notBefore: "1993-01-01", notAfter: "1998-12-31" },
  { key: "addon_the_discman_skip", title: "The Discman Skip", kind: "filler", text: "{worker1}'s entrance music must cut out and loop every time they take a step to simulate a portable CD player skipping.", notBefore: "1990-01-01", notAfter: "1996-12-31" },
  { key: "addon_y2k_preparedness", title: "Y2K Preparedness", kind: "serious", text: "{worker1} must begin hoarding every midcard championship in {initials} because they believe the belts will be the only valid currency after the millennium bug hits.", notBefore: "1999-01-01", notAfter: "1999-12-31" },
  { key: "addon_the_boy_band_invasion", title: "The Boy Band Invasion", kind: "filler", text: "{maleWorker1}, {maleWorker2}, and {maleWorker3} must form a synchronized dancing stable and sing their own entrance theme poorly.", notBefore: "1997-01-01", notAfter: "1999-12-31" },
  { key: "addon_rap_rock_revolution", title: "Rap-Rock Revolution", kind: "filler", text: "{topWorker} must come to the ring wearing a backwards red baseball cap and perform a 5-minute rap-metal anthem about \"doing it all for the nookie.\"", notBefore: "1998-01-01", notAfter: "1999-12-31" },
  { key: "addon_the_infomercial_specialist", title: "The Infomercial Specialist", kind: "serious", text: "{worker1} must attempt to sell a \"ThighMaster\" or a \"George Foreman Grill\" to their opponent mid-match to secure a submission.", notBefore: "1990-01-01", notAfter: "1995-12-31" },
  { key: "addon_pogs_for_titles", title: "Pogs for Titles", kind: "serious", text: "{midcardTitle} will not be defended in a match tonight; {worker1} and {worker2} must play a high-stakes game of Pogs to determine the champion.", notBefore: "1993-01-01", notAfter: "1996-12-31" },
  { key: "addon_the_slasher_movie_twist", title: "The Slasher Movie Twist", kind: "serious", text: "{femaleWorker1} must be stalked through the backstage area by a masked assailant who asks her what her \"favorite scary wrestling match\" is.", notBefore: "1996-01-01", notAfter: "1999-12-31" },
  { key: "addon_virtual_reality_combat", title: "Virtual Reality Combat", kind: "filler", text: "{worker1} must wear a bulky VR headset to the ring and claim they are wrestling a \"digital ghost\" while {worker2} watches in confusion.", notBefore: "1992-01-01", notAfter: "1995-12-31" },
  { key: "addon_talk_show_trash", title: "Talk Show Trash", kind: "filler", text: "The main event segment must be a talk show hosted by {topWorker} that inevitably results in {femaleWorker1} and {femaleWorker2} throwing chairs at each other.", notBefore: "1991-01-01", notAfter: "1998-12-31" },
  { key: "addon_the_tickle_me_elmo_riots", title: "The Tickle Me Elmo Riots", kind: "serious", text: "{worker1} and {worker2} must brawl through a local toy store over the last available holiday plush toy instead of having their scheduled match.", notBefore: "1996-10-01", notAfter: "1996-12-31" },
  { key: "addon_supermarket_sweepstakes", title: "Supermarket Sweepstakes", kind: "filler", text: "{leastOverWorker} is given 30 seconds to run through the {initials} merchandise stand and keep whatever they can carry.", notBefore: "1990-01-01", notAfter: "1995-12-31" },
  { key: "addon_the_real_world_confessional", title: "The \"Real World\" Confessional", kind: "filler", text: "{worker1} must sit in a dimly lit room and talk directly to a shaky camera about why {worker2} isn't being \"real\" enough.", notBefore: "1992-01-01", notAfter: "1999-12-31" },
  { key: "addon_laser_pointer_menace", title: "Laser Pointer Menace", kind: "filler", text: "{worker1} must be distracted by a mysterious red dot moving across their chest during their entire title defense.", notBefore: "1997-01-01", notAfter: "1999-12-31" },
  { key: "addon_flat_top_maintenance", title: "Flat-Top Maintenance", kind: "filler", text: "{maleWorker1} must spend an entire segment having his hair meticulously leveled with a spirit level to ensure the perfect 90-degree angle.", notBefore: "1990-01-01", notAfter: "1993-12-31" },
  { key: "addon_the_64_bit_powerhouse", title: "The 64-Bit Powerhouse", kind: "serious", text: "{worker1} must defeat {worker2} in a match where the loser has to go to the back and delete their favorite save file on a Nintendo 64.", notBefore: "1996-01-01", notAfter: "1998-12-31" },
  { key: "addon_macarena_madness", title: "Macarena Madness", kind: "filler", text: "Every worker involved in the Battle Royal tonight must pause and perform the Macarena at the 5-minute mark or face immediate elimination.", notBefore: "1995-01-01", notAfter: "1996-12-31" },
  { key: "addon_the_magic_eye_challenge", title: "The \"Magic Eye\" Challenge", kind: "filler", text: "{worker1} must stare at a poster for ten minutes and refuse to wrestle until they can clearly see the hidden 3D image of a sailboat.", notBefore: "1993-01-01", notAfter: "1995-12-31" },
  { key: "addon_the_payphone_promo", title: "The Payphone Promo", kind: "filler", text: "{worker1} must be filmed at a greasy truck stop payphone calling {worker2} to deliver a menacing, static-filled threat.", notBefore: "1980-01-01", notAfter: "1989-12-31" },
  { key: "addon_saturday_morning_cartoon_tie_in", title: "Saturday Morning Cartoon Tie-In", kind: "filler", text: "{topWorker} must spend an entire segment interacting with a poorly rotoscoped animated version of themselves to promote a new cartoon.", notBefore: "1984-01-01", notAfter: "1989-12-31" },
  { key: "addon_the_vhs_tape_delay", title: "The VHS Tape Delay", kind: "filler", text: "{worker1} must record a \"special message\" that is played on the big screen, but the footage must be tracking-distorted and look like a third-generation bootleg.", notBefore: "1980-01-01", notAfter: "1989-12-31" },
  { key: "addon_closed_circuit_crisis", title: "Closed-Circuit Crisis", kind: "serious", text: "The {worldTitle} match must be booked as a \"Closed-Circuit Television\" exclusive, meaning it cannot be shown on free TV tonight.", notBefore: "1983-01-01", notAfter: "1989-12-31" },
  { key: "addon_rock_n_wrestling_connection", title: "Rock 'n' Wrestling Connection", kind: "filler", text: "{femaleWorker1} must be accompanied to the ring by a mid-tier 80s pop star who is clearly only there for the royalty check.", notBefore: "1984-01-01", notAfter: "1987-12-31" },
  { key: "addon_the_territory_raid", title: "The Territory Raid", kind: "serious", text: "You must sign {freeAgent1} immediately and book them to squash {worker1} to show that {otherPromotion} is \"small-time.\"", notBefore: "1982-01-01", notAfter: "1986-12-31" },
  { key: "addon_generic_jobber_jubilee", title: "Generic Jobber Jubilee", kind: "serious", text: "{topWorker} must face three different unnamed local enhancement talents (use {freeAgent1}, {freeAgent2}, {freeAgent3}) in back-to-back squash matches.", notAfter: "1989-12-31" },
  { key: "addon_the_1_900_hotline_hype", title: "The 1-900 Hotline Hype", kind: "filler", text: "{worker1} must spend their entire interview telling fans to call the {initials} Hotline at $1.99 per minute to find out \"the truth\" about {worker2}.", notBefore: "1987-01-01", notAfter: "1989-12-31" },
  { key: "addon_polished_pompadour_problems", title: "Polished Pompadour Problems", kind: "filler", text: "{maleWorker1} must lose his match via count-out because he was too busy checking his hair in a handheld mirror at ringside.", notAfter: "1989-12-31" },
  { key: "addon_the_national_anthem_opening", title: "The National Anthem Opening", kind: "filler", text: "{worker1} must open the show by singing a painfully long, off-key version of the National Anthem while {topWorker} stands at attention.", notAfter: "1989-12-31" },
  { key: "addon_the_tabloid_scandal", title: "The Tabloid Scandal", kind: "serious", text: "{worker1} has been caught in a \"scandalous\" photo with a Hollywood starlet; they must be suspended for one show to \"let the heat die down.\"" },
  { key: "addon_the_foreign_power_object", title: "The Foreign Power Object", kind: "serious", text: "{worker1} must defeat {worker2} by using a hidden roll of coins, a brass knuckle, or a loaded boot while the referee is distracted.", notAfter: "1989-12-31" },
  { key: "addon_cold_war_confrontation", title: "Cold War Confrontation", kind: "serious", text: "{worker1} must adopt a \"Soviet Menace\" gimmick and burn a picture of a bald eagle to start a feud with {topWorker}.", notBefore: "1980-01-01", notAfter: "1988-12-31" },
  { key: "addon_the_main_event_special", title: "The Main Event Special", kind: "serious", text: "You must move your {worldTitle} match to a special Friday Night \"Main Event\" slot, leaving the weekend show with only squash matches.", notBefore: "1985-01-01", notAfter: "1989-12-31" },
  { key: "addon_celebrity_guest_timekeeper", title: "Celebrity Guest Timekeeper", kind: "filler", text: "{worker1} must defend the {midcardTitle} while a \"B-List\" sitcom star acts as the guest timekeeper and constantly interrupts the flow of the match.", notAfter: "1989-12-31" },
  { key: "addon_the_workout_montage", title: "The Workout Montage", kind: "filler", text: "{maleWorker1} must be featured in a 5-minute training montage involving heavy lifting, raw eggs, and a very tight headband.", notAfter: "1989-12-31" },
  { key: "addon_the_poster_giveaway", title: "The Poster Giveaway", kind: "filler", text: "{worker1} must spend a segment handing out signed, neon-colored posters of themselves to confused children in the front row.", notAfter: "1989-12-31" },
  { key: "addon_lunchbox_marketing", title: "Lunchbox Marketing", kind: "filler", text: "{topWorker} must carry a new {initials} branded metal lunchbox to the ring and use it as a weapon when the referee isn't looking.", notBefore: "1984-01-01", notAfter: "1989-12-31" },
  { key: "addon_high_stakes_arm_wrestling", title: "High-Stakes Arm Wrestling", kind: "serious", text: "{maleWorker1} and {maleWorker2} will settle their rivalry tonight not in a match, but in a televised Arm Wrestling contest.", notAfter: "1989-12-31" },
  { key: "addon_the_manager_s_contract", title: "The Manager's Contract", kind: "serious", text: "{worker1} must win a match against {worker2} to \"win the contract\" and managerial services of {oldestWorker}.", notAfter: "1989-12-31" },
  { key: "addon_posedown_challenge", title: "Posedown Challenge", kind: "filler", text: "{maleWorker1} and {maleWorker2} must compete in a 10-minute \"Bodybuilding Posedown\" to determine who has the \"most impressive physique.\"", notAfter: "1989-12-31" },
  { key: "addon_the_interview_pit", title: "The Interview Pit", kind: "filler", text: "{worker1} must host a chaotic interview segment where they smash a flower vase or a coconut over the head of {worker2}.", notBefore: "1982-01-01", notAfter: "1989-12-31" },
  { key: "addon_bad_jacket_mandate", title: "Bad Jacket Mandate", kind: "filler", text: "{worker1} must debut a new ring jacket featuring at least 500 sequins and a fringe that is long enough to be a safety hazard.", notBefore: "1980-01-01", notAfter: "1985-12-31" },
  { key: "addon_the_ribbon_ribbon_cutting", title: "The Ribbon Ribbon Cutting", kind: "filler", text: "{topWorker} must hold a \"Grand Opening\" ceremony for a new brand of vitamins or a gym, only to be attacked by {worker1}.", notAfter: "1989-12-31" },
  { key: "addon_megastar_tag_team", title: "Megastar Tag Team", kind: "serious", text: "{topWorker} and {worker1} must form a \"Mega-Power\" style tag team tonight, even if they were feuding ten minutes ago.", notAfter: "1989-12-31" },
  { key: "addon_the_ruthless_aggression_mandate", title: "The Ruthless Aggression Mandate", kind: "serious", text: "{developmental1} must march to the ring, slap {topWorker} across the face, and shout about their \"undeniable aggression.\"", notBefore: "2002-06-01", notAfter: "2005-12-31" },
  { key: "addon_the_brand_extension_split", title: "The Brand Extension Split", kind: "serious", text: "{worker1} and {worker2} are now exclusive to different shows and cannot interact until the next big event.", notBefore: "2002-03-25", notAfter: "2011-08-29" },
  { key: "addon_myspace_top_8_drama", title: "MySpace Top 8 Drama", kind: "filler", text: "{femaleWorker1} must turn heel because {femaleWorker2} moved her down to the fourth spot on her MySpace Top 8.", notBefore: "2003-08-01", notAfter: "2008-12-31" },
  { key: "addon_the_guest_host_menace", title: "The Guest Host Menace", kind: "filler", text: "A D-list celebrity is running the show tonight; {worker1} must spend 10 minutes teaching them how to execute a headlock.", notBefore: "2009-06-22", notAfter: "2010-12-31" },
  { key: "addon_bra_and_panties_main_event", title: "Bra and Panties Main Event", kind: "serious", text: "{femaleWorker1} and {femaleWorker2} must settle the {womensTitle} rankings in a match where the first person stripped to their undergarments loses.", notBefore: "2000-01-01", notAfter: "2007-12-31" },
  { key: "addon_spin_the_wheel_make_the_deal", title: "Spin the Wheel, Make the Deal", kind: "filler", text: "{worker1} and {worker2} must wrestle in a \"San Francisco 49ers Match\" where four boxes are placed on poles, one containing the {worldTitle}.", notBefore: "2000-01-01", notAfter: "2000-12-31" },
  { key: "addon_the_blue_pill_miracle", title: "The Blue Pill Miracle", kind: "filler", text: "{oldestWorker} must cut a promo claiming they have \"found their groove again\" thanks to a specific brand of male enhancement pills.", notBefore: "2002-01-01", notAfter: "2005-12-31" },
  { key: "addon_the_illegal_download_shoot", title: "The Illegal Download Shoot", kind: "filler", text: "{worker1} must blame the fans for \"stealing money from my pocket\" by downloading {initials} entrance themes on Napster.", notBefore: "2000-01-01", notAfter: "2004-12-31" },
  { key: "addon_evolution_of_a_stable", title: "Evolution of a Stable", kind: "serious", text: "{topWorker} must form a group with {oldestWorker} and {developmental1} to ensure they control every title in {initials}.", notBefore: "2003-01-01", notAfter: "2005-10-01" },
  { key: "addon_the_spirit_of_the_squad", title: "The Spirit of the Squad", kind: "filler", text: "{maleWorker1}, {maleWorker2}, and {maleWorker3} must all change their names to \"Nicky,\" \"Mitch,\" and \"Johnny\" and become male cheerleaders.", notBefore: "2006-01-01", notAfter: "2006-12-31" },
  { key: "addon_ipod_shuffle_entrance", title: "iPod Shuffle Entrance", kind: "filler", text: "{worker1} must come to the ring wearing white earbuds and ignoring the crowd to show how \"detached and cool\" they are.", notBefore: "2005-01-01", notAfter: "2010-12-31" },
  { key: "addon_the_million_dollar_mania", title: "The Million Dollar Mania", kind: "filler", text: "{worker1} must give away $10,000 of the {promotion} budget to a random fan via a giant novelty check that keeps falling apart.", notBefore: "2008-01-01", notAfter: "2008-07-01" },
  { key: "addon_who_blew_up_the_limo", title: "Who Blew Up The Limo?", kind: "serious", text: "{topWorker} is \"presumed dead\" after a pyrotechnic accident; {worker1} must lead a ten-bell salute while holding back laughter.", notBefore: "2007-06-11", notAfter: "2007-09-01" },
  { key: "addon_the_name_shortener", title: "The Name Shortener", kind: "filler", text: "{worker1} has too many names; from now on, they are simply \"{worker1}\" and all mention of their other name is a finable offense.", notBefore: "2008-01-01" },
  { key: "addon_the_ufc_crossover", title: "The UFC Crossover", kind: "serious", text: "{maleWorker1} must adopt a \"Real Fighter\" gimmick and refuse to perform any wrestling moves, only throwing awkward \"MMA-style\" punches.", notBefore: "2005-01-01" },
  { key: "addon_you_re_fired_again", title: "You're Fired! (Again)", kind: "serious", text: "{leastOverWorker} is fired on the spot, but must return 20 minutes later wearing a fake mustache as a new character called \"{freeAgent1}.\"" },
  { key: "addon_the_laptop_gm", title: "The Laptop GM", kind: "filler", text: "All matches tonight are booked via an anonymous email sent to a laptop on a podium; {worker1} must read the alerts in a robotic voice.", notBefore: "2010-06-21" },
  { key: "addon_the_hair_vs_hair_gamble", title: "The Hair-VS-Hair Gamble", kind: "serious", text: "{topWorker} and {worker1} must put their hair on the line; the loser must be shaved bald in the center of the ring tonight.", notBefore: "2000-01-01", notAfter: "2007-12-31" },
  { key: "addon_rap_battle_insult", title: "Rap Battle Insult", kind: "filler", text: "{maleWorker1} must perform a freestyle rap mocking {worker2}'s lack of charisma and questionable fashion choices.", notBefore: "2002-10-01", notAfter: "2005-05-01" },
  { key: "addon_the_casket_of_2004", title: "The Casket of 2004", kind: "serious", text: "{worker1} must be \"buried alive\" by {worker2}, requiring a 3-month hiatus while they \"recover from the dirt.\"", notBefore: "2004-01-01", notAfter: "2004-12-31" },
  { key: "addon_high_definition_horror", title: "High-Definition Horror", kind: "filler", text: "{oldestWorker} must cut a promo complaining that the new HD cameras make their wrinkles look \"unacceptably deep.\"", notBefore: "2008-01-01", notAfter: "2010-12-31" },
  { key: "addon_the_money_in_the_bank", title: "The Money in the Bank", kind: "serious", text: "{worker1} wins a briefcase and must spend every segment tonight standing at the top of the ramp pointing at the {worldTitle} holder.", notBefore: "2005-04-03" },
  { key: "addon_the_reality_tv_star", title: "The Reality TV Star", kind: "filler", text: "{freeAgent1} is signed because they were on a reality show; they must defeat {worker1} despite not knowing how to run the ropes.", notBefore: "2001-01-01", notAfter: "2004-12-31" },
  { key: "addon_the_great_american_bash_heat", title: "The Great American Bash Heat", kind: "filler", text: "{worker1} must drive a lowrider to the ring and hand out hot dogs to the fans to prove how \"American\" they are.", notBefore: "2004-01-01", notAfter: "2004-07-31" },
  { key: "addon_straight_edge_society", title: "Straight Edge Society", kind: "serious", text: "{maleWorker1} must shave the head of {worker2} to \"purify\" them and force them into a lifestyle of no caffeine and no fun.", notBefore: "2009-01-01", notAfter: "2010-12-31" },
  { key: "addon_the_virtual_crowd_mandate", title: "The Virtual Crowd Mandate", kind: "filler", text: "The arena is empty; {worker1} must spend their entire promo screaming at a wall of LED screens to get a reaction.", notBefore: "2020-03-01", notAfter: "2021-06-01" },
  { key: "addon_cinematic_chaos", title: "Cinematic Chaos", kind: "serious", text: "The {worldTitle} match will not take place in the ring; {maleWorker1} and {maleWorker2} must fight at a local swamp, graveyard, or corporate headquarters.", notBefore: "2020-01-01" },
  { key: "addon_the_tribal_acknowledgment", title: "The Tribal Acknowledgment", kind: "serious", text: "{topWorker} demands respect; {worker1} and {worker2} must come to the ring and \"acknowledge\" them or face immediate termination.", notBefore: "2020-08-01" },
  { key: "addon_twitch_stream_suspension", title: "Twitch Stream Suspension", kind: "serious", text: "{worker1} has been caught streaming on a third-party platform; they are suspended for the night and must forfeit {midcardTitle}.", notBefore: "2020-09-01" },
  { key: "addon_forbidden_door_entry", title: "Forbidden Door Entry", kind: "serious", text: "{freeAgent1} from {otherPromotion} walks through the curtain tonight and must defeat {topWorker} in a non-title shocker.", notBefore: "2021-01-01" },
  { key: "addon_the_budget_cut_massacre", title: "The Budget Cut Massacre", kind: "serious", text: "{initials} needs to save on overhead; {worker1}, {worker2}, and {worker3} are released effective immediately.", notBefore: "2020-01-01" },
  { key: "addon_social_media_like_feud", title: "Social Media \"Like\" Feud", kind: "filler", text: "{femaleWorker1} turns heel because {femaleWorker2} liked a \"disrespectful\" tweet about her ring gear.", notBefore: "2020-01-01" },
  { key: "addon_the_masked_singer_rip_off", title: "The Masked Singer Rip-off", kind: "filler", text: "{maleWorker1} must debut a new gimmick where they wear a giant hot dog costume and refuse to reveal their identity until they lose a match.", notBefore: "2020-01-01" },
  { key: "addon_wellness_tech_guru", title: "Wellness Tech Guru", kind: "filler", text: "{worker1} adopts a \"Bio-Hacking\" gimmick and refuses to wrestle unless the ring temperature is exactly 68 degrees.", notBefore: "2021-01-01" },
  { key: "addon_nft_drop_disaster", title: "NFT Drop Disaster", kind: "filler", text: "{worker1} spends their entire segment trying to explain the value of a digital drawing of a bored ape to {oldestWorker}.", notBefore: "2021-01-01", notAfter: "2022-12-31" },
  { key: "addon_the_what_s_my_name_pivot", title: "The \"What's My Name?\" Pivot", kind: "filler", text: "{worker1} has their name changed to something nonsensical like \"Doudrop,\" \"Gunther,\" or \"Shorty G\" for the remainder of the month.", notBefore: "2020-01-01" },
  { key: "addon_underground_fight_club", title: "Underground Fight Club", kind: "serious", text: "{worker1} and {worker2} must wrestle in a basement with no ropes and a \"raw\" aesthetic to boost the ratings.", notBefore: "2020-08-01", notAfter: "2020-10-31" },
  { key: "addon_the_podcast_shoot", title: "The Podcast Shoot", kind: "filler", text: "{worker1} records a \"shoot\" podcast mid-ring airing all of {initials} dirty laundry and burying management.", notBefore: "2020-01-01" },
  { key: "addon_ai_booking_assistant", title: "AI Booking Assistant", kind: "filler", text: "The main event is booked by a chatbot; {worker1} must wrestle {worker2} in a \"Cyber-Mechanical Dream Match.\"", notBefore: "2023-01-01" },
  { key: "addon_the_mystery_box_winner", title: "The Mystery Box Winner", kind: "serious", text: "{leastOverWorker} wins a \"Mystery Briefcase\" and must cash it in tonight for the {worldTitle} during the main event.", notBefore: "2020-01-01" },
  { key: "addon_zero_prestige_title_defense", title: "Zero-Prestige Title Defense", kind: "serious", text: "The {midcardTitle} must be defended against {freeAgent1} in a match that takes place entirely in a parking lot.", notBefore: "2020-01-01" },
  { key: "addon_the_tiktok_challenge", title: "The TikTok Challenge", kind: "filler", text: "{maleWorker1} and {maleWorker2} must perform a synchronized dance trend for 60 seconds before their match can officially start.", notBefore: "2020-01-01" },
  { key: "addon_long_term_storyline_fatigue", title: "Long-Term Storyline Fatigue", kind: "serious", text: "The feud between {worker1} and {worker2} must continue for another 14 months, regardless of how bored the fans are.", notBefore: "2022-01-01" },
  { key: "addon_corporate_consultant_mandate", title: "Corporate Consultant Mandate", kind: "filler", text: "{worker1} is assigned a \"Brand Consultant\" who follows them to the ring and corrects their posture during promos.", notBefore: "2020-01-01" },
  { key: "addon_the_invisible_opponent", title: "The Invisible Opponent", kind: "filler", text: "Due to a travel delay, {worker1} must wrestle an \"Invisible {worker2}\" for 10 minutes and sell every move.", notBefore: "2020-01-01" },
  { key: "addon_streaming_service_exclusive", title: "Streaming Service Exclusive", kind: "serious", text: "Tonight's {worldTitle} match is \"exclusive to the app,\" meaning the live crowd gets to watch a blank screen instead.", notBefore: "2021-01-01" },
  { key: "addon_the_heel_turn_over_a_video_game", title: "The Heel Turn over a Video Game", kind: "serious", text: "{maleWorker1} betrays {maleWorker2} after losing a high-stakes game of a popular battle royale backstage.", notBefore: "2020-01-01" },
  { key: "addon_crowd_noise_injection", title: "Crowd Noise Injection", kind: "filler", text: "{worker1} is cutting a serious promo, but the production truck must play loud \"booing\" sound effects over the speakers anyway.", notBefore: "2020-01-01", notAfter: "2021-06-01" },
  { key: "addon_the_influencer_invitation", title: "The Influencer Invitation", kind: "serious", text: "{freeAgent1} (a famous YouTuber) is signed to a massive deal and must defeat {topWorker} in their debut match.", notBefore: "2021-01-01" },
  { key: "addon_the_retribution_riot", title: "The Retribution Riot", kind: "serious", text: "{worker1}, {worker2}, and {worker3} must wear black masks and throw a chainsaw through a ring post to show they are \"anti-establishment.\"", notBefore: "2020-08-01", notAfter: "2021-01-31" },
  { key: "addon_the_last_minute_replacement", title: "The Last Minute Replacement", kind: "serious", text: "{worker1} has been \"unexpectedly detained\" at the airport; {leastOverWorker} must take their place in the main event tonight." },
  { key: "addon_the_unplanned_shoot", title: "The Unplanned Shoot", kind: "filler", text: "{worker1} is going off-script; they must spend five minutes \"breaking the fourth wall\" and burying the {initials} creative team." },
  { key: "addon_wardrobe_malfunction", title: "Wardrobe Malfunction", kind: "filler", text: "{worker1} must wrestle their entire match while visibly struggling to keep their gear from falling apart." },
  { key: "addon_the_mystery_benefactor", title: "The Mystery Benefactor", kind: "serious", text: "{freeAgent1} debuts tonight as the hand-picked protege of {oldestWorker} and must be given a title shot immediately." },
  { key: "addon_concession_stand_brawl", title: "Concession Stand Brawl", kind: "serious", text: "The match between {maleWorker1} and {maleWorker2} must end in the arena lobby involving mustard, soda, and a folding table." },
  { key: "addon_excessive_pyrotechnics", title: "Excessive Pyrotechnics", kind: "filler", text: "The production team went overboard; {worker1}'s entrance must be completely obscured by a thick, lingering cloud of sulfur and smoke." },
  { key: "addon_the_lost_championship", title: "The \"Lost\" Championship", kind: "serious", text: "{worker1} claims they lost the physical {midcardTitle} belt in a taxi; the match tonight must be for a cardboard replica." },
  { key: "addon_mandatory_manager_swap", title: "Mandatory Manager Swap", kind: "serious", text: "{worker1} and {worker2} must trade managers for one night to \"see if the chemistry improves.\"" },
  { key: "addon_the_local_sportscaster", title: "The Local Sportscaster", kind: "filler", text: "A local news anchor is at ringside; {topWorker} must accidentally knock their coffee over, sparking a three-month feud." },
  { key: "addon_double_turn_disaster", title: "Double Turn Disaster", kind: "serious", text: "{maleWorker1} must start the match as a hero and end as a villain, while {maleWorker2} does the exact opposite." },
  { key: "addon_the_catering_poisoning", title: "The Catering Poisoning", kind: "serious", text: "Half the roster has food poisoning; {worker1} must wrestle three matches tonight to fill the vacant time slots." },
  { key: "addon_unintelligible_promo", title: "Unintelligible Promo", kind: "filler", text: "{worker1} must deliver a high-energy promo entirely in a language they don't actually speak." },
  { key: "addon_the_referee_s_revenge", title: "The Referee's Revenge", kind: "serious", text: "The referee for tonight's main event is {worker1}, who has a documented 10-year grudge against {topWorker}." },
  { key: "addon_brand_new_catchphrase", title: "Brand New Catchphrase", kind: "filler", text: "{worker1} must repeat a nonsensical new catchphrase at least six times during their backstage interview." },
  { key: "addon_the_surprise_paternity_test", title: "The Surprise Paternity Test", kind: "filler", text: "{maleWorker1} interrupts the show to claim that {maleWorker2} is actually the father of {femaleWorker1}’s unborn child." },
  { key: "addon_technical_difficulties", title: "Technical Difficulties", kind: "filler", text: "The arena lights go out mid-match; {worker1} and {worker2} must finish the bout using only the glow of the fans' lighters or phones." },
  { key: "addon_the_veteran_lesson", title: "The \"Veteran\" Lesson", kind: "serious", text: "{oldestWorker} must defeat {developmental1} in a \"Respect\" match and then force them to carry their bags for a month." },
  { key: "addon_commentary_strike", title: "Commentary Strike", kind: "filler", text: "The announcers have walked out in protest; {worker1} and {worker2} must provide color commentary for their own match while wrestling it." },
  { key: "addon_the_contract_on_a_pole", title: "The Contract on a Pole", kind: "serious", text: "{freeAgent1} and {worker1} must compete in a match where the legal right to work for {initials} is suspended 15 feet in the air." },
  { key: "addon_sudden_gimmick_infringement", title: "Sudden Gimmick Infringement", kind: "filler", text: "{worker1} comes to the ring dressed exactly like {topWorker} and proceeds to use all of their signature moves." },
  { key: "addon_the_sponsor_s_mandate", title: "The Sponsor's Mandate", kind: "filler", text: "{worker1} must wear a giant sandwich board or a branded costume to promote {initials}’s new partnership with a local bakery." },
  { key: "addon_the_foreign_object_lottery", title: "The Foreign Object Lottery", kind: "serious", text: "{worker1} and {worker2} must wrestle a match where the only legal weapons are items found in the trunk of a car." },
  { key: "addon_the_mute_monster", title: "The Mute Monster", kind: "filler", text: "{maleWorker1} is no longer allowed to speak, growl, or make noise; {femaleWorker1} must act as their \"voice\" via a megaphone." },
  { key: "addon_zero_g_final", title: "Zero-G Final", kind: "filler", text: "The ring crew forgot to tighten the ropes; {worker1} and {worker2} must perform the match without touching the turnbuckles once." },
  { key: "addon_the_ego_trip", title: "The Ego Trip", kind: "serious", text: "{topWorker} demands a 20-minute video package celebrating their career to open the show, cutting the opening match down to 60 seconds." },
];

const BUILT_IN_TEMPLATE_SERIOUS_RULES: RuleDef[] = BUILT_IN_TEMPLATE_ADDONS.filter((rule) => rule.kind === "serious").map((rule) => ({
  key: rule.key,
  title: rule.title,
  eligible: () => true,
  resolve: (ctx) => resolveTemplateText(rule.text, ctx),
  notBefore: rule.notBefore,
  notAfter: rule.notAfter,
}));

const BUILT_IN_TEMPLATE_FILLER_RULES: FillerTemplate[] = BUILT_IN_TEMPLATE_ADDONS.filter((rule) => rule.kind === "filler").map((rule) => ({
  key: rule.key,
  title: rule.title,
  resolve: (ctx) => resolveTemplateText(rule.text, ctx),
  notBefore: rule.notBefore,
  notAfter: rule.notAfter,
}));

const EXTRA_SERIOUS_RULES: RuleDef[] = [
  { key: "world_hot_potato", title: "World Hot Potato", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} must change hands on back-to-back shows.` },
  { key: "midcard_elevator", title: "Prestige Elevator", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")], 1), resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")]))} must capture ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))}.` },
  { key: "tag_breakup", title: "Mandatory Break-Up", eligible: (ctx) => !!tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b] = workerPair(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)); return `${workerName(a)} and ${workerName(b)} are now a dysfunctional tag team and must immediately challenge for ${beltName(tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id))}.`; } },
  { key: "old_timer_ref", title: "Live Via Satellite", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `${workerName(oldestWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must return for a month-long guest referee feud with ${workerName(randomFrom([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "upper")]))}.` },
  { key: "commentary_takeover", title: "Headset Hostility", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `The commentary team must become an active part of the next ${ctx.promotion.initials} feud, whether they like it or not.` },
  { key: "main_event_throwaway", title: "TV Giveaway", eligible: (ctx) => atLeast(workersByTier(ctx, "main"), 2), resolve: (ctx) => { const picks = workerGroup(workersByTier(ctx, "main"), 2); return `${picks[0]} versus ${picks[1]} must be thrown away on free TV with almost no buildup.`; } },
  { key: "legend_killer_reverse", title: "Legend Killer in Reverse", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(workersByTier(ctx, "main").length ? workersByTier(ctx, "main") : activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must lose repeatedly to veterans and still act like a dangerous killer.` },
  { key: "free_agent_flop", title: "Market Misfire", eligible: (ctx) => atLeast(freeAgents(ctx.universe.workers), 1), resolve: (ctx) => `${workerName(randomFrom(freeAgents(ctx.universe.workers)))} must be signed, heavily hyped, and then saddled with an awful comedy gimmick almost immediately.` },
  { key: "authority_romance", title: "Power Imbalance", eligible: (ctx) => atLeast(menWorkers(ctx.universe.workers, ctx.promotion.id), 1) && atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => { const [a,b] = maleFemalePair(ctx); return a && b ? `${workerName(a)} must spend the next month abusing management power in pursuit of ${workerName(b)}.` : `An authority figure must abuse their power to pursue a deeply inappropriate male/female romance angle.`; } },
  { key: "stable_resurrection", title: "Back From the Dead", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3), resolve: (ctx) => `${ctx.promotion.initials} must revive a dead stable concept and pretend it is the hottest idea in wrestling.` },
  { key: "mystery_sibling", title: "Long-Lost Sibling", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must be given a long-lost sibling who debuts immediately, despite looking absolutely nothing alike.` },
  { key: "shared_title_swap", title: "Title Exchange Program", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `A champion vs champion match must end in total nonsense that causes ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} and ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} to effectively swap owners.` },
  { key: "all_multiman", title: "More Wrestlers, More Ratings", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 6), resolve: (ctx) => `Your next ${ctx.promotion.initials} show must be built almost entirely from multi-person matches so everybody gets crammed onto the card.` },
  { key: "full_show_ref", title: "One Ref to Rule Them All", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must referee the whole show and personally ruin every finish.` },
  { key: "movie_synergy", title: "Studio Notes", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `An entire ${ctx.promotion.initials} show must be warped around promoting a new movie starring ${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))}.` },
  { key: "gender_bender", title: "Identity Crisis", eligible: (ctx) => atLeast(menWorkers(ctx.universe.workers, ctx.promotion.id), 1) && atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must debut a gender-bending gimmick and win under it.` },
  { key: "masked_title", title: "Under the Hood", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must win ${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} under a mask or disguise.` },
  { key: "developmental_tag_takeover", title: "Prospect Problem", eligible: (ctx) => !!tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(developmentalWorkers(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `${workerGroup(developmentalWorkers(ctx.universe.workers, ctx.promotion.id), 2).join(" and ")} must debut as a tag team threat to ${beltName(tagTitleForPromotion(ctx.universe.belts, ctx.promotion.id))}.` },
  { key: "women_close_show", title: "Main Event Mandate", eligible: (ctx) => atLeast(womenWorkers(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `A women’s program must close the next ${ctx.promotion.initials} show, and commentary must insist it was always the plan.` },
  { key: "friendship_tournament", title: "Unexpected Allies", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b] = [topWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)), bottomWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id))]; return `${workerName(a)} and ${workerName(b)} must form a strangely sincere friendship that actively helps them win matches.`; } },
  { key: "cruiser_rebrand", title: "Division Rebrand", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} must be completely reimagined around workrate, style points, and whatever buzzword management likes this week.` },
  { key: "production_truck", title: "Truck Meltdown", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must cause havoc in the production truck during the show.` },
  { key: "pet_champion", title: "Unacceptable Champion", eligible: (ctx) => titleBeltsForPromotion(ctx.universe.belts, ctx.promotion.id).length > 0, resolve: (_ctx) => `An inanimate object, pet, mascot, or similarly stupid substitute must leave the show recognized as a champion.` },
  { key: "network_panic", title: "Network Notes", eligible: () => true, resolve: (ctx) => `Network executives have intervened. The next ${ctx.promotion.initials} main event must be reworked into something much dumber but allegedly more marketable.` },
  { key: "retirement_clock", title: "Retirement Threat", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(oldestWorker(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} declares they will retire after one more loss. Management immediately books the loss.` },
  { key: "manager_debut", title: "Fresh Advisor", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must debut a completely new manager on the next show.` },
  { key: "faction_b_team", title: "B-Team Energy", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3), resolve: (ctx) => `Three random ${ctx.promotion.initials} workers must become the embarrassing B-team version of a much cooler stable.` },
  { key: "one_show_detectives", title: "Procedural Pilot", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `${workerGroup(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2).join(" and ")} must be repackaged as 1970s TV detectives for at least one show.` },
  { key: "forced_pet_project", title: "Executive Favourite", eligible: (ctx) => atLeast([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")], 1), resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "lower"), ...workersByTier(ctx, "opener"), ...workersByTier(ctx, "jobber")]))} has suddenly become management’s hand-picked pet project and must be pushed like a star.` },
  { key: "world_title_tour", title: "Champion's Tour", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3), resolve: (ctx) => `${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} must be defended repeatedly in weird settings and against increasingly unsuitable challengers.` },
  { key: "double_life", title: "Double Life", eligible: (ctx) => !!womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id) && atLeast(menWorkers(ctx.universe.workers, ctx.promotion.id), 1), resolve: (ctx) => `${workerName(randomFrom(menWorkers(ctx.universe.workers, ctx.promotion.id)))} must somehow become entangled with ${beltName(womenTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} through an absurd double-life angle.` },
  { key: "buried_alive", title: "Needlessly Extreme", eligible: (ctx) => atLeast([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "lower")], 2), resolve: (ctx) => { const picks = workerGroup([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "lower")], 2); return `${picks[0]} and ${picks[1]} must end their feud in a Buried Alive match.`; } },
  { key: "free_agent_invasion", title: "Worst Invasion Ever", eligible: (ctx) => atLeast(freeAgents(ctx.universe.workers), 3), resolve: (ctx) => `${workerGroup(freeAgents(ctx.universe.workers), 3).join(", ")} must invade ${ctx.promotion.initials}, be treated like huge threats, and then immediately look useless.` },
  { key: "weekly_screwjob", title: "Weekly Screwjob", eligible: () => true, resolve: (ctx) => `At least one finish on every ${ctx.promotion.initials} show this week must be a screwjob, fast count, or wildly suspicious referee call.` },
  { key: "mailroom_romance", title: "Mailroom Romance", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must pursue an incredibly stupid romance angle through letters, gifts, or public humiliation.` },
  { key: "secondary_title_glowup", title: "Belt Makeover", eligible: (ctx) => !!midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `${beltName(midcardTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} must be rebranded, restyled, or otherwise given a ridiculous relaunch.` },
  { key: "forced_music_act", title: "Music Industry Plant", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3), resolve: (ctx) => `${workerGroup(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 3).join(", ")} must become a wrestling band and management must insist they are crossover stars.` },
  { key: "main_event_gimmick_match", title: "Because It Ratings", eligible: (ctx) => atLeast([...workersByTier(ctx, "main"), ...workersByTier(ctx, "upper")], 2), resolve: (ctx) => `The next ${ctx.promotion.initials} main event must be turned into an overbooked gimmick match whether the feud calls for it or not.` },
  { key: "champion_goes_crazy", title: "Champion Loses the Plot", eligible: (ctx) => !!worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id), resolve: (ctx) => `The reigning ${beltName(worldTitleForPromotion(ctx.universe.belts, ctx.promotion.id))} holder must adopt a deranged new obsession that dominates every promo.` },
  { key: "random_petty_feud", title: "Pettiest Feud Alive", eligible: (ctx) => atLeast(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 2), resolve: (ctx) => { const [a,b] = workerPair(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)); return `${workerName(a)} and ${workerName(b)} must begin a feud over something embarrassingly petty.`; } },
];

const EXTRA_FILLER_TEMPLATES: FillerTemplate[] = [
  { key: "sponsor_match", title: "Sponsored Violence", resolve: (ctx) => `At least one match on the next ${ctx.promotion.initials} show must shamelessly exist to advertise a sponsor.` },
  { key: "announcer_bias", title: "Broadcast Vendetta", resolve: (_ctx) => `One announcer must openly root for a specific wrestler all night and nobody is allowed to stop it.` },
  { key: "ring_prop", title: "Needless Prop", resolve: () => `A completely pointless prop must become central to a major angle.` },
  { key: "mystery_box", title: "Mystery Box", resolve: () => `A mysterious box must appear on the show and its eventual contents should somehow be more disappointing than expected.` },
  { key: "terrible_makeover", title: "Makeover Segment", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must get an ill-advised makeover live on television.` },
  { key: "broken_music", title: "Wrong Theme Song", resolve: (ctx) => `Somebody's entrance music must be changed to something profoundly embarrassing on the next ${ctx.promotion.initials} show.` },
  { key: "guest_host", title: "Guest Host Energy", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must somehow end up hosting a chunk of the show.` },
  { key: "mascot_match", title: "Mascot Involvement", resolve: () => `A mascot, costume character, or similarly undignified figure must get physically involved in a match.` },
  { key: "forced_poetry", title: "Poetry Slam", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must cut a poem instead of a normal promo.` },
  { key: "backstage_tour", title: "Guided Tour", resolve: () => `A lengthy backstage skit must waste everybody's time and still somehow be treated like essential television.` },
  { key: "wheel_of_stips", title: "Spin the Wheel", resolve: () => `A wheel or randomizer must decide a match stipulation, and the result should be ridiculous.` },
  { key: "celebrity_name_drop", title: "Synergy Mention", resolve: () => `The broadcast must repeatedly mention a celebrity, movie, or sponsor that has almost nothing to do with wrestling.` },
  { key: "giant_birthday", title: "Birthday Segment", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must be forced into a painfully long birthday or celebration segment.` },
  { key: "awkward_dance", title: "Dance Break", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must dance on the show, whether the audience wants it or not.` },
  { key: "parking_lot", title: "Parking Lot Business", resolve: () => `A major confrontation must spill into a parking lot because subtlety is dead.` },
  { key: "conspiracy_board", title: "Conspiracy Promo", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must unveil an absurd conspiracy theory complete with visual aids.` },
  { key: "food_fight", title: "Catering Catastrophe", resolve: () => `A feud must escalate through a food fight, catering brawl, or other deeply unserious workplace incident.` },
  { key: "dramatic_reading", title: "Dramatic Reading", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must deliver a dramatic reading of something that should never have been written.` },
  { key: "terrible_merch", title: "Merch Push", resolve: () => `Management insists on pushing a terrible piece of merchandise as if it will save the quarter.` },
  { key: "camera_chaos", title: "Cut to Black", resolve: () => `Production must miss something important and pretend it was intentional.` },
  { key: "vague_prophecy", title: "Prophetic Nonsense", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must cut a promo that sounds profound but means absolutely nothing.` },
  { key: "understudy", title: "Replacement Wrestler", resolve: () => `Somebody must be replaced at the last second by an obviously worse substitute.` },
  { key: "mercy_rule", title: "Mercy Rule", resolve: () => `An authority figure must randomly end a match or segment early for reasons that make no real sense.` },
  { key: "social_media", title: "Trending Now", resolve: () => `A storyline beat must be justified entirely through the vague promise that it will trend online.` },
  { key: "surprise_return", title: "Needless Return", resolve: (ctx) => `A former ${ctx.promotion.initials} name or very old veteran must return for a pop and immediately complicate everything.` },
  { key: "brand_summit", title: "Emergency Summit", resolve: (ctx) => `Management demands an emergency summit segment on the next ${ctx.promotion.initials} show that solves nothing.` },
  { key: "contract_signing", title: "Of Course It Breaks Down", resolve: () => `There must be a contract signing, and yes, it must dissolve into violence.` },
  { key: "special_entrance", title: "Budget Misuse", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must receive an absurdly elaborate entrance for a totally unearned reason.` },
  { key: "awkward_product_demo", title: "Product Demonstration", resolve: () => `A wrestler must demonstrate or endorse a product in a segment that makes everyone look foolish.` },
  { key: "state_of_company", title: "State of the Company", resolve: (ctx) => `The next ${ctx.promotion.initials} show must include a painfully long address about the state of the company.` },
];

function gimmickRuleText(name: string, ctx: RuleContext) {
  const worker = workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)));
  const special: Record<string, string> = {
    "Postal Worker": `${worker} must adopt a Postal Worker gimmick and spend every show delivering letters, warnings, or emotional damage with full government efficiency.`,
    "Detective": `${worker} must debut a Detective gimmick immediately. They are now expected to investigate mysteries nobody asked them to solve.`,
    "Movie Star": `${worker} must become a Movie Star gimmick and carry themselves like a blockbuster icon despite working in this madhouse.`,
    "Rock Star": `${worker} must be repackaged as a Rock Star. Ego, volume, and completely unearned self-importance are now mandatory.`,
    "Clown": `${worker} must become a Clown. The line between comedy and nightmare fuel is now your problem to manage.`,
    "Evil Clown": `${worker} must become an Evil Clown because apparently management looked at wrestling and thought, "needs more nightmare fuel."`,
    "Magician": `${worker} must debut a Magician gimmick. Wrestling is now secondary to whether they can “make things disappear.”`,
    "Boy Band": `${worker} must be folded into a Boy Band act. Management insists this is crossover appeal.`,
    "Authority Figure": `${worker} must become an Authority Figure and abuse that power with the confidence of someone who has never once been told no.`,
    "Hero": `${worker} must become a Hero figure, presented as one of the last decent people left in this stupid company.`,
    "Monster": `${worker} must be rebuilt as a Monster. Selling is optional. Looming is not.`,
    "Savage": `${worker} must adopt a Savage gimmick immediately. They are now a snarling menace one bad promo away from biting somebody.`,
    "Comedy Character": `${worker} must become a Comedy Character. This is either going to get weirdly over or ruin them completely.`,
    "Adult Film Star": `${worker} must debut an Adult Film Star gimmick. Expect innuendo, scandal, and all the subtlety of a folding chair to the skull.`,
  };
  if (special[name]) return special[name];
  return `${worker} must debut a new ${name} gimmick immediately. Management expects everyone to act like this is a brilliant creative breakthrough.`;
}

const GIMMICK_FILLER_TEMPLATES: FillerTemplate[] = GIMMICKS.filter((g) => g.id > 0 && ![66, 203].includes(Number(g.id)) && String(g.name || '').trim() !== 'None').map((g) => ({
  key: `gimmick_${g.id}`,
  title: `Gimmick Pivot: ${g.name}`,
  resolve: (ctx) => gimmickRuleText(g.name, ctx),
}));

const FILLER_TEMPLATES: FillerTemplate[] = [
  { key: "diet_soda", title: "Diet Soda Disaster", resolve: (ctx) => `This month's main feud in ${ctx.promotion.initials} is now entirely about somebody spilling another person's diet soda.` },
  { key: "all_nonfinish", title: "Nothing Finishes", resolve: (ctx) => `Every match on the next ${ctx.promotion.initials} show must end in a count-out, DQ, or non-finish.` },
  { key: "drop_toe_hold_death", title: "Career-Threatening Drop Toe Hold", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} debuts a drop toe hold that commentary sells like a near-fatal war crime.` },
  { key: "barbershop_quartet", title: "Four-Part Harmony", resolve: (ctx) => `${workerGroup(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id), 4).join(", ")} are now a barbershop singer stable and must perform during matches.` },
  { key: "canadian_purge", title: "International Incident", resolve: (ctx) => `A politician insults pro wrestling in a speech, so management retaliates by firing every Canadian in ${ctx.promotion.initials}.` },
  { key: "postal_worker", title: "Mail Call", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must adopt a postal worker gimmick and deliver love letters on every show.` },
  { key: "all_sponsors", title: "Corporate Integration", resolve: (ctx) => `Every segment on the next ${ctx.promotion.initials} show must somehow revolve around a sponsor activation.` },
  { key: "authority_figure", title: "One-Night Authority", resolve: (ctx) => `${workerName(randomFrom(womenWorkers(ctx.universe.workers, ctx.promotion.id).length ? womenWorkers(ctx.universe.workers, ctx.promotion.id) : activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} becomes authority figure for one night and abuses the power wildly.` },
  { key: "game_show", title: "Quiz Show Champion", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} becomes a game show host and will only defend a title against people who can answer trivia questions.` },
  { key: "alien_abduction", title: "Taken", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} gets abducted by aliens.` },
  { key: "hot_dog_pole", title: "Hot Dog on a Pole", resolve: (ctx) => `${workerName(randomFrom([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "upper")]))} and ${workerName(randomFrom([...workersByTier(ctx, "mid"), ...workersByTier(ctx, "upper")]))} feud over hot dogs for two months before a Hot Dog on a Pole match.` },
  { key: "musical_week", title: "Full Musical", resolve: (ctx) => `For one full week, ${ctx.promotion.initials} becomes an all-singing, all-dancing musical.` },
  { key: "trampoline_match", title: "Bounce House", resolve: () => `A match must take place on a trampoline.` },
  { key: "star_trek_parody", title: "Trekked Out", resolve: (ctx) => `Your main event is replaced by a Star Trek parody skit starring ${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} and as many other workers as possible.` },
  { key: "mini_golf", title: "Mini-Golf Blood Feud", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must now feud over mini-golf supremacy.` },
  { key: "live_sex_celebration", title: "Terrible Nostalgia", resolve: (ctx) => `${ctx.promotion.initials} brings back the Live Sex Celebration, because clearly that is the answer.` },
  { key: "lounge_lizards", title: "Swing Revival", resolve: (ctx) => `Introduce a stable of lounge lizard swing singers into ${ctx.promotion.initials}. They are now a major act.` },
  { key: "reality_show", title: "The Real World", resolve: (ctx) => `A month-long reality-show segment debuts on ${ctx.promotion.initials}, starring wrestlers who should never live together.` },
  { key: "brawl_4_all", title: "Brawl 4 All", resolve: () => `Brawl 4 All. No further explanation will be provided.` },
  { key: "random_ref", title: "Ref for a Night", resolve: (ctx) => `${workerName(randomFrom(activeWorkersForPromotion(ctx.universe.workers, ctx.promotion.id)))} must become the special referee for the entire show and ruin every finish.` },
];

function buildResolvedDeck(ctx: RuleContext, recentRuleKeys?: Set<string>): { cards: ActiveCard[]; seriousCount: number; fillerCount: number } {
  const recent = recentRuleKeys ?? new Set<string>();
  const allSerious = createSeriousRuleLibrary(ctx)
    .filter((rule) => !HIDDEN_RULE_KEYS.has(rule.key))
    .filter((rule) => isRuleDateEligible(rule, ctx.universe.currentDateIso))
    .filter((rule) => { try { return rule.eligible(ctx); } catch { return false; } });
  const seriousPool = shuffle(allSerious.filter((rule) => !recent.has(rule.key)));
  const seriousSource = seriousPool.length ? seriousPool : shuffle(allSerious);
  const chosenSerious = seriousSource.slice(0, 52);
  const cards: ActiveCard[] = [];
  let seriousCount = 0;
  let fillerCount = 0;

  chosenSerious.forEach((rule, index) => {
    const slotId = CARD_FACE_ORDER[index];
    cards.push({ slotId, ruleKey: rule.key, title: rule.title, text: rule.resolve(ctx), kind: "serious" });
    seriousCount += 1;
  });

  const customFillerPool: FillerTemplate[] = CUSTOM_RULE_PACK.filler.filter((spec) => !HIDDEN_COLLECTIONS.has(String(spec.collection || "").trim() || "Ungrouped")).map((spec) => ({ key: spec.key, title: spec.title, resolve: (inner) => resolveTemplateText(spec.text, inner), notBefore: spec.notBefore, notAfter: spec.notAfter }));
  const allFiller = [...FILLER_TEMPLATES, ...EXTRA_FILLER_TEMPLATES, ...BUILT_IN_TEMPLATE_FILLER_RULES, ...GIMMICK_FILLER_TEMPLATES, ...customFillerPool].filter((template) => !HIDDEN_RULE_KEYS.has(template.key)).filter((template) => isRuleDateEligible(template, ctx.universe.currentDateIso));
  const filteredFiller = allFiller.filter((template) => !recent.has(template.key));
  const fillerPool = shuffle(filteredFiller.length ? filteredFiller : allFiller);
  while (cards.length < 52) {
    const slotId = CARD_FACE_ORDER[cards.length];
    const template = fillerPool[fillerCount % fillerPool.length];
    cards.push({ slotId, ruleKey: `${template.key}_${fillerCount + 1}`, title: template.title, text: template.resolve(ctx), kind: "filler" });
    fillerCount += 1;
  }

  return { cards: shuffle(cards), seriousCount, fillerCount };
}

function defaultState(universe: UniverseSnapshot, promotionId?: number, history?: HistoryItem[]): CrankyState {
  const promotion = promoById(universe.promotions, Number(promotionId || universe.promotions[0]?.id || 0)) ?? universe.promotions[0];
  const recentRuleKeys = new Set((history || []).map((h) => String((h as any).ruleKey || "")).filter(Boolean).slice(0, 20));
  const built = buildResolvedDeck({ universe, promotion }, recentRuleKeys);
  return {
    version: STATE_VERSION,
    sessionName: "",
    week: 1,
    activeDeck: built.cards,
    offeredCards: [],
    selectedPromotionId: Number(promotion?.id || 0),
    chosenCard: null,
    history: [],
    seriousCount: built.seriousCount,
    fillerCount: built.fillerCount,
  };
}

export default function CrankyVinceEditor({ workspaceRoot }: Props) {
  const [status, setStatus] = useState("");
  const [saveRoot, setSaveRoot] = useState("");
  const [universe, setUniverse] = useState<UniverseSnapshot | null>(null);
  const [state, setState] = useState<CrankyState | null>(null);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [recentSessions, setRecentSessions] = useState<SessionEntry[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [customRulesText, setCustomRulesText] = useState("{\n  \"rules\": []\n}");
  const [customRulesError, setCustomRulesError] = useState("");
  const [selectedBuiltInRule, setSelectedBuiltInRule] = useState<{ key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string } | null>(null);
  const [selectedCustomRuleKey, setSelectedCustomRuleKey] = useState<string | null>(null);
  const [selectedViewedCustomRuleKey, setSelectedViewedCustomRuleKey] = useState<string | null>(null);
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState<string>("all");
  const [customRulesListState, setCustomRulesListState] = useState<CustomRuleSpec[]>([]);
  const [editingCollectionName, setEditingCollectionName] = useState<string>("");
  const [, setHiddenRuleVersion] = useState(0);
  const [editorViewMode, setEditorViewMode] = useState<"standard" | "code">("standard");
  const ruleTextRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setCustomRulesListState([...(CUSTOM_RULE_PACK.serious || []), ...(CUSTOM_RULE_PACK.filler || [])]);
  }, []);

  const chosenHistory = selectedHistoryIndex !== null ? state?.history?.[selectedHistoryIndex] ?? null : null;
  const currentDisplay = chosenHistory ?? state?.chosenCard ?? null;
  const currentRuleTitle = currentDisplay?.title ?? "Cranky Vince";
  const currentRuleText = currentDisplay?.text ?? `Cranky Vince is a save-aware deck of booking disasters based on the EWB Diary Dome challenge created by board member brenchill. It studies your real promotion, roster, champions, and current situation, then hits you with one absurd new mandate every week, like you’re booking under a delusional tyrant who changes the entire card five minutes before bell time because he’s suddenly convinced "That's Good shit, pal!"`;
  const currentRuleKind = currentDisplay?.kind ?? null;
  const currentCardFace = currentDisplay?.slotId ? (CARD_FACE_MAP[currentDisplay.slotId] || CARD_BACK) : "";
  const previewPromotion = promoById(universe?.promotions ?? [], state?.selectedPromotionId || 0) ?? universe?.promotions?.[0] ?? null;
  const previewCtx = universe && previewPromotion ? ({ universe, promotion: previewPromotion } as RuleContext) : null;

  const builtInSeriousRules = createSeriousRuleLibrary(previewCtx ?? undefined).map((rule) => ({
    key: rule.key,
    title: rule.title,
    kind: "serious" as const,
    sampleText: previewCtx ? (() => { try { return rule.resolve(previewCtx); } catch { return ""; } })() : "",
    notBefore: rule.notBefore || "",
    notAfter: rule.notAfter || "",
  })).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const builtInFillerRules = [...FILLER_TEMPLATES, ...EXTRA_FILLER_TEMPLATES, ...BUILT_IN_TEMPLATE_FILLER_RULES, ...GIMMICK_FILLER_TEMPLATES].map((rule) => ({
    key: rule.key,
    title: rule.title,
    kind: "filler" as const,
    sampleText: previewCtx ? (() => { try { return rule.resolve(previewCtx); } catch { return ""; } })() : "",
    notBefore: rule.notBefore || "",
    notAfter: rule.notAfter || "",
  })).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const builtInSeriousTitles = builtInSeriousRules.map((rule) => rule.title);
  const builtInFillerTitles = builtInFillerRules.map((rule) => rule.title);
  const selectedViewedCustomRule = customRulesListState.find((rule) => String(rule.key) === String(selectedViewedCustomRuleKey || "")) ?? null;

  function createNoSaveTemplatePreviewContext(): RuleContext {
    const promotion = { id: 1, name: "__PROMOTION__", initials: "__INITIALS__", shortName: "__INITIALS__", sizeRaw: 3 } as any;
    const otherPromo = { id: 2, name: "__OTHER_PROMOTION__", initials: "__OTHER_INITIALS__", shortName: "__OTHER_INITIALS__", sizeRaw: 3 } as any;
    const makeWorker = (id: number, name: string, overnessRaw: number, ageRaw: number, genderRaw: number, positionRaw = 1, employed = true) => ({
      id,
      name,
      overnessRaw,
      ageRaw,
      genderRaw,
      employer1PromoId: employed ? 1 : 0,
      employer1PositionRaw: employed ? positionRaw : 0,
      employer2PromoId: 0,
      employer2PositionRaw: 0,
      employer3PromoId: 0,
      employer3PositionRaw: 0,
      contractCode: employed ? "" : "PPA",
    } as any);
    const workers = [
      makeWorker(1, "__TOP_WORKER__", 95, 33, 65535, 1, true),
      makeWorker(2, "__WORKER_1__", 85, 31, 65535, 1, true),
      makeWorker(3, "__WORKER_2__", 75, 29, 65535, 2, true),
      makeWorker(4, "__WORKER_3__", 65, 27, 65535, 3, true),
      makeWorker(5, "__LEAST_OVER_WORKER__", 20, 24, 65535, 6, true),
      makeWorker(6, "__OLDEST_WORKER__", 70, 58, 65535, 4, true),
      makeWorker(7, "__MALE_WORKER_1__", 60, 30, 65535, 1, true),
      makeWorker(8, "__MALE_WORKER_2__", 55, 28, 65535, 1, true),
      makeWorker(9, "__MALE_WORKER_3__", 50, 26, 65535, 1, true),
      makeWorker(10, "__FEMALE_WORKER_1__", 68, 29, 1, 1, true),
      makeWorker(11, "__FEMALE_WORKER_2__", 58, 27, 1, 1, true),
      makeWorker(12, "__FEMALE_WORKER_3__", 48, 25, 1, 1, true),
      makeWorker(13, "__DEVELOPMENTAL_1__", 35, 22, 65535, 7, true),
      makeWorker(14, "__DEVELOPMENTAL_2__", 33, 21, 1, 7, true),
      makeWorker(15, "__FREE_AGENT_1__", 52, 32, 65535, 1, false),
      makeWorker(16, "__FREE_AGENT_2__", 47, 30, 1, 1, false),
      makeWorker(17, "__FREE_AGENT_3__", 42, 28, 65535, 1, false),
    ] as any[];
    const belts = [
      { index: 1, ownerPromoId: 1, isSinglesTitle: true, isWomensTitle: false, image: 100, name: "__WORLD_TITLE__" },
      { index: 2, ownerPromoId: 1, isSinglesTitle: true, isWomensTitle: false, image: 80, name: "__MIDCARD_TITLE__" },
      { index: 3, ownerPromoId: 1, isSinglesTitle: false, isWomensTitle: false, image: 70, name: "__TAG_TITLE__" },
      { index: 4, ownerPromoId: 1, isSinglesTitle: true, isWomensTitle: true, image: 90, name: "__WOMENS_TITLE__" },
    ] as any[];
    return { promotion, universe: { promotions: [promotion, otherPromo], workers, belts } as any } as RuleContext;
  }

  function resolveBuiltInRuleSample(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string } | null) {
    if (!rule) return "";
    const directSample = String(rule.sampleText || "").trim();
    if (directSample) return directSample;

    const activeCtx = previewCtx ?? createNoSaveTemplatePreviewContext();
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      if (rule.kind === "serious") {
        const live = createSeriousRuleLibrary(activeCtx).find((item) => item.key === rule.key || item.title === rule.title);
        if (!live) return "";
        const resolved = String(live.resolve(activeCtx) || "").trim();
        return activeCtx === previewCtx ? resolved : placeholderizeResolvedText(resolved, activeCtx).trim();
      }
      const live = [...FILLER_TEMPLATES, ...EXTRA_FILLER_TEMPLATES, ...BUILT_IN_TEMPLATE_FILLER_RULES, ...GIMMICK_FILLER_TEMPLATES].find((item) => item.key === rule.key || item.title === rule.title);
      if (!live) return "";
      const resolved = String(live.resolve(activeCtx) || "").trim();
      return activeCtx === previewCtx ? resolved : placeholderizeResolvedText(resolved, activeCtx).trim();
    } catch {
      return "";
    } finally {
      Math.random = originalRandom;
    }
  }

  function placeholderStarterFromBuiltIn(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string } | null) {
    const resolved = resolveBuiltInRuleSample(rule);
    if (!String(resolved || "").trim()) return "";
    return String(resolved || "").trim();
  }


  function crankyWorkspaceDir(root = workspaceRoot) {
    return root ? `${root}/EWRes/cranky_vince` : "";
  }

  function crankySaveDir(root = saveRoot) {
    return root ? `${root}/EWRes/cranky_vince` : "";
  }

  function registryPath() {
    const dir = crankyWorkspaceDir();
    return dir ? `${dir}/${SESSIONS_FILE}` : "";
  }

  function customRulesRegistryPath() {
    const dir = crankyWorkspaceDir();
    return dir ? `${dir}/${CUSTOM_RULES_FILE}` : "";
  }

  function hiddenRulesRegistryPath(root = saveRoot) {
    const dir = crankySaveDir(root);
    return dir ? `${dir}/${HIDDEN_RULES_FILE}` : "";
  }

  function hiddenCollectionsRegistryPath(root = saveRoot) {
    const dir = crankySaveDir(root);
    return dir ? `${dir}/${HIDDEN_COLLECTIONS_FILE}` : "";
  }

  function stateRegistryPath(root = saveRoot) {
    const dir = crankySaveDir(root);
    return dir ? `${dir}/${STATE_FILE}` : "";
  }

  function readGlobalCustomRulesFromStorage() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return { serious: [], filler: [] };
      const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_RULES_STORAGE_KEY) || '{"rules":[]}');
      return normalizeCustomRulePack(parsed);
    } catch {
      return { serious: [], filler: [] };
    }
  }

  async function persistGlobalCustomRules(pack: { serious: CustomRuleSpec[]; filler: CustomRuleSpec[] }) {
    const normalized = normalizeCustomRulePack({ rules: [...(pack?.serious || []), ...(pack?.filler || [])] });
    const doc = JSON.stringify({ rules: [...normalized.serious, ...normalized.filler] }, null, 2);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(CUSTOM_RULES_STORAGE_KEY, doc);
      }
    } catch {}

    const path = customRulesRegistryPath();
    if (path) {
      const dir = path.slice(0, path.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(path, encodeText(doc));
    }

    CUSTOM_RULE_PACK = normalized;
    syncCustomRulesState(normalized);
    return normalized;
  }

  function readRecentSessionsFromStorage(): SessionEntry[] {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const parsed = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
      const rows = Array.isArray(parsed?.sessions) ? parsed.sessions as SessionEntry[] : [];
      return rows.filter((row) => row && typeof row.root === "string" && row.root.trim());
    } catch {
      return [];
    }
  }

  async function persistRecentSessions(rows: SessionEntry[]) {
    const cleaned = rows
      .filter((row) => row && typeof row.root === "string" && row.root.trim())
      .sort((a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0))
      .slice(0, 12);
    setRecentSessions(cleaned);

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessions: cleaned }));
      }
    } catch {}

    const path = registryPath();
    if (path) {
      try {
        const dir = path.slice(0, path.lastIndexOf("/"));
        await mkdir(dir, { recursive: true });
        await writeFile(path, encodeText(JSON.stringify({ sessions: cleaned }, null, 2)));
      } catch {}
    }

    return cleaned;
  }

  async function loadRecentSessions() {
    const path = registryPath();
    try {
      let rows: SessionEntry[] = [];
      if (path && await exists(path)) {
        const parsed = JSON.parse(textFile(await readFile(path)));
        rows = Array.isArray(parsed?.sessions) ? parsed.sessions as SessionEntry[] : [];
      } else {
        rows = readRecentSessionsFromStorage();
      }
      return await persistRecentSessions(rows);
    } catch {
      const rows = readRecentSessionsFromStorage();
      return await persistRecentSessions(rows);
    }
  }

  async function rememberSession(root: string, nextState: CrankyState, snap: UniverseSnapshot) {
    const promo = promoById(snap.promotions, nextState.selectedPromotionId) ?? snap.promotions[0] ?? null;
    const existing = await loadRecentSessions();
    const entry: SessionEntry = {
      root,
      label: root.split(/[\/]/).pop() || root,
      promotionInitials: String(promo?.initials || "").trim() || undefined,
      lastOpened: Date.now(),
      week: Number(nextState.week || 1),
      promotionId: Number(nextState.selectedPromotionId || 0),
      promotionLabel: promo ? `${promo.name} (${promo.initials})` : "No promotion",
    };
    await persistRecentSessions([entry, ...existing.filter((item) => item.root !== root)]);
  }

  async function openSaveSession(root: string) {
    try {
      const promosPath = `${root}/promos.dat`;
      const wrestlerPath = `${root}/wrestler.dat`;
      const promosOk = await exists(promosPath);
      const wrestlerOk = await exists(wrestlerPath);
      if (!promosOk || !wrestlerOk) {
        const existing = await loadRecentSessions();
        await persistRecentSessions(existing.filter((item) => item.root !== root));
        if (saveRoot === root) {
          setSaveRoot("");
          setUniverse(null);
          setState(null);
          setSelectedHistoryIndex(null);
        }
        setStatus(`Could not load ${root.split(/[\\/]/).pop() || root}. The save folder is missing promos.dat or wrestler.dat, so the stale session entry was removed.`);
        return;
      }

      const snap = await loadUniverse(root);
      const path = stateRegistryPath(root);
      if (!path || !(await exists(path))) {
        setSaveRoot(root);
        setUniverse(snap);
        setState(null);
        setSelectedHistoryIndex(null);
        setStatus(`No Cranky Vince state exists yet for ${root.split(/[\\/]/).pop() || root}. Use Create New Session to make one.`);
        return;
      }

      const parsed = JSON.parse(textFile(await readFile(path))) as CrankyState;
      setSaveRoot(root);
      setUniverse(snap);
      setState(parsed);
      setSelectedHistoryIndex(null);
      await loadCustomRulesEditor();
      await rememberSession(root, parsed, snap);
      setStatus(`Loaded ${root.split(/[\\/]/).pop() || root}. Week ${parsed.week} with ${parsed.seriousCount} serious cards and ${parsed.fillerCount} filler cards in the locked deck. Custom rules loaded: ${CUSTOM_RULE_PACK.serious.length} serious, ${CUSTOM_RULE_PACK.filler.length} filler.`);
    } catch (e: any) {
      console.error(e);
      const existing = await loadRecentSessions();
      await persistRecentSessions(existing.filter((item) => item.root !== root));
      setStatus(`Could not load session for ${root.split(/[\\/]/).pop() || root}: ${e?.message || String(e)}`);
    }
  }

  async function loadSaveFolderContext(root: string) {
    const promosPath = `${root}/promos.dat`;
    const wrestlerPath = `${root}/wrestler.dat`;
    const promosOk = await exists(promosPath);
    const wrestlerOk = await exists(wrestlerPath);
    if (!promosOk || !wrestlerOk) {
      setStatus(`Could not open ${root.split(/[\\/]/).pop() || root}. The folder is missing promos.dat or wrestler.dat.`);
      return;
    }
    const snap = await loadUniverse(root);
    setSaveRoot(root);
    setUniverse(snap);
    setState(null);
    setSelectedHistoryIndex(null);
    setStatus(`Loaded save folder ${root.split(/[\\/]/).pop() || root}. Select or create a Cranky Vince session.`);
  }

  async function handleDeleteSessionCard(root: string) {
    try {
      const path = stateRegistryPath(root);
      if (path && await exists(path)) {
        await remove(path);
      }
      const existing = await loadRecentSessions();
      await persistRecentSessions(existing.filter((item) => item.root !== root));
      if (saveRoot === root) {
        setState(null);
        setSelectedHistoryIndex(null);
        setStatus(`Deleted Cranky Vince session for ${root.split(/[\\/]/).pop() || root}.`);
      } else {
        setStatus(`Deleted saved Cranky Vince session for ${root.split(/[\\/]/).pop() || root}.`);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`Delete session failed: ${e?.message || String(e)}`);
    }
  }

  async function handleCreateNewSession() {
    if (!saveRoot || !universe) {
      setStatus("Select Save Folder first.");
      return;
    }
    try {
      const promoId = state?.selectedPromotionId || universe.promotions[0]?.id || 0;
      const next = defaultState(universe, promoId, state?.history || []);
      setState(next);
      setSelectedHistoryIndex(null);
      await persistState(next);
      await rememberSession(saveRoot, next, universe);
      setStatus(`Created new Cranky Vince session for ${promotionInitials(universe.promotions, next.selectedPromotionId)} with ${next.seriousCount} serious cards and ${next.fillerCount} filler cards.`);
    } catch (e: any) {
      console.error(e);
      setStatus(`Create session failed: ${e?.message || String(e)}`);
    }
  }

  useEffect(() => {
    void loadRecentSessions();
    void loadCustomRulesEditor();
  }, [workspaceRoot]);

  async function persistState(next: CrankyState, root = saveRoot) {
    const path = stateRegistryPath(root);
    if (!path) return;
    const dir = path.slice(0, path.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path, encodeText(JSON.stringify(next, null, 2)));
  }

  function serializeCurrentCustomRules() {
    return JSON.stringify({ rules: [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler] }, null, 2);
  }

  function placeholderDescriptions() {
    return [
      ["{promotion}", "The full promotion name for the selected promotion context."],
      ["{initials}", "The promotion initials or short label used by the selected promotion."],
      ["{worker1}", "A randomly chosen active worker from the selected promotion."],
      ["{worker2}", "A second randomly chosen active worker from the selected promotion."],
      ["{worker3}", "A third randomly chosen active worker from the selected promotion."],
      ["{maleWorker}", "A randomly chosen male worker from the selected promotion."],
      ["{femaleWorker}", "A randomly chosen female worker from the selected promotion."],
      ["{maleWorker1}", "The first randomly chosen male worker from the selected promotion."],
      ["{maleWorker2}", "A second randomly chosen male worker from the selected promotion."],
      ["{maleWorker3}", "A third randomly chosen male worker from the selected promotion."],
      ["{femaleWorker1}", "The first randomly chosen female worker from the selected promotion."],
      ["{femaleWorker2}", "A second randomly chosen female worker from the selected promotion."],
      ["{femaleWorker3}", "A third randomly chosen female worker from the selected promotion."],
      ["{topWorker}", "One of the most over workers in the selected promotion context."],
      ["{leastOverWorker}", "The least over active worker in the selected promotion."],
      ["{oldestWorker}", "The oldest active worker in the selected promotion."],
      ["{freeAgent1}", "A randomly chosen available free agent."],
      ["{freeAgent2}", "A second randomly chosen available free agent."],
      ["{freeAgent3}", "A third randomly chosen available free agent."],
      ["{developmental1}", "A randomly chosen developmental worker from the selected promotion, if one exists."],
      ["{developmental2}", "A second randomly chosen developmental worker from the selected promotion, if one exists."],
      ["{worldTitle}", "The promotion’s highest prestige world championship."],
      ["{midcardTitle}", "A midcard singles title from the selected promotion."],
      ["{tagTitle}", "A tag team championship from the selected promotion."],
      ["{womensTitle}", "A women’s championship from the selected promotion."],
      ["{otherPromotion}", "Another promotion in the loaded save for cross-brand style rules."],
    ] as Array<[string, string]>;
  }

  function currentEditorRule(): CustomRuleSpec {
    const parsed = parseEditorRuleInput(customRulesText);
    if (parsed) return parsed;
    return { key: "custom_new_rule", title: "New Custom Rule", kind: "serious", text: "Write your custom Cranky Vince rule text here.", notBefore: "", notAfter: "", requirements: {} };
  }

  function slugifyCustomRuleKeyBase(value: string) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "rule";
  }

  function buildUniqueCustomRuleKey(rule: CustomRuleSpec, existingRules: CustomRuleSpec[], editingKey?: string | null) {
    const rawKey = String(rule.key || "").trim();
    const placeholderKeys = new Set(["", "custom_new_rule", "custom_serious_rule", "custom_filler_rule"]);
    const baseKey = placeholderKeys.has(rawKey)
      ? `custom_${slugifyCustomRuleKeyBase(String(rule.title || rawKey || "rule"))}`
      : rawKey;
    const taken = new Set(
      existingRules
        .map((item) => String(item.key || "").trim())
        .filter((key) => key && key !== String(editingKey || "").trim())
    );
    if (!taken.has(baseKey)) return baseKey;
    let counter = 2;
    let candidate = `${baseKey}_${counter}`;
    while (taken.has(candidate)) {
      counter += 1;
      candidate = `${baseKey}_${counter}`;
    }
    return candidate;
  }

  function setEditorRule(rule: CustomRuleSpec) {
    setCustomRulesText(JSON.stringify({ rules: [rule] }, null, 2));
  }

  function updateEditorRuleField(field: keyof CustomRuleSpec, value: any) {
    const rule = currentEditorRule();
    const next = { ...rule, [field]: field === "notBefore" || field === "notAfter" ? String(value ?? "").trim() : value };
    setEditorRule(next);
    setCustomRulesError("");
  }

  function _updateEditorRequirementsText(value: string) {
  void _updateEditorRequirementsText;

    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      updateEditorRuleField("requirements", parsed);
    } catch (e: any) {
      setCustomRulesError(`Requirements JSON is invalid: ${e?.message || String(e)}`);
    }
  }

  function buildInRuleViewerText(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string } | null) {
    if (!rule) return "Select a built-in rule to preview the placeholder-based starter template that this rule uses.";
    return builtInStarterText(rule);
  }


  function insertPlaceholderAtCursor(token: string) {
    const area = ruleTextRef.current;
    const current = currentEditorRule();
    const source = String(current.text || "");
    if (!area) {
      updateEditorRuleField("text", `${source}${token}`);
      return;
    }
    const start = area.selectionStart ?? source.length;
    const end = area.selectionEnd ?? source.length;
    const nextText = `${source.slice(0, start)}${token}${source.slice(end)}`;
    updateEditorRuleField("text", nextText);
    requestAnimationFrame(() => {
      try {
        area.focus();
        const pos = start + token.length;
        area.setSelectionRange(pos, pos);
      } catch {}
    });
  }

  async function persistHiddenRules(root = saveRoot) {
    const path = hiddenRulesRegistryPath(root);
    if (!path) return;
    const dir = path.slice(0, path.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path, encodeText(JSON.stringify({ hiddenRuleKeys: [...HIDDEN_RULE_KEYS] }, null, 2)));
  }

  async function persistHiddenCollections(root = saveRoot) {
    const path = hiddenCollectionsRegistryPath(root);
    if (!path) return;
    const dir = path.slice(0, path.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path, encodeText(JSON.stringify({ hiddenCollections: [...HIDDEN_COLLECTIONS] }, null, 2)));
  }

  function collectionNameOf(rule: CustomRuleSpec) {
    return String(rule.collection || "").trim() || "Ungrouped";
  }

  async function handleToggleHiddenCollection(collectionName: string) {
    const key = String(collectionName || "").trim() || "Ungrouped";
    try {
      if (HIDDEN_COLLECTIONS.has(key)) HIDDEN_COLLECTIONS.delete(key);
      else HIDDEN_COLLECTIONS.add(key);
      await persistHiddenCollections();
      setHiddenRuleVersion((v) => v + 1);
      setStatus(`Collection "${key}" is now ${HIDDEN_COLLECTIONS.has(key) ? "hidden" : "visible"} in Cranky Vince runs.`);
      if (state?.selectedPromotionId && typeof window !== "undefined" && window.confirm("Collection visibility changed. Rebuild the current deck now?")) {
        await rebuildDeckForPromotion(state.selectedPromotionId);
      }
    } catch (e: any) {
      setStatus(`Could not update collection visibility: ${e?.message || String(e)}`);
    }
  }

  async function handleExportCollection(collectionName: string) {
    try {
      const key = String(collectionName || "").trim() || "Ungrouped";
      const rules = [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler].filter((rule) => collectionNameOf(rule) === key);
      const out = await save({
        defaultPath: `${key.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "collection"}_rules.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (!out) return;
      await writeFile(String(out), encodeText(JSON.stringify({ rules }, null, 2)));
      setStatus(`Exported collection "${key}".`);
    } catch (e: any) {
      setStatus(`Could not export collection: ${e?.message || String(e)}`);
    }
  }

  async function handleRenameCollection(oldName: string, newName: string) {
    const from = String(oldName || "").trim() || "Ungrouped";
    const to = String(newName || "").trim();
    if (!to) {
      setStatus("Collection name cannot be blank.");
      return;
    }
    try {
      const rules = [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler].map((rule) =>
        collectionNameOf(rule) === from ? { ...rule, collection: to } : rule
      );
      const nextPack = normalizeCustomRulePack({ rules });
      await persistGlobalCustomRules(nextPack);
      if (HIDDEN_COLLECTIONS.has(from)) {
        HIDDEN_COLLECTIONS.delete(from)
        HIDDEN_COLLECTIONS.add(to)
        await persistHiddenCollections()
      }
      setEditingCollectionName("");
      setStatus(`Renamed collection "${from}" to "${to}".`);
    } catch (e: any) {
      setStatus(`Could not rename collection: ${e?.message || String(e)}`);
    }
  }

  async function handleCopyAiStarterPrompt() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(AI_RULE_GENERATOR_STARTER_PROMPT);
        setStatus("AI rule generator starter prompt copied to clipboard.");
      } else {
        setStatus("Clipboard copy is not available in this environment.");
      }
    } catch (e: any) {
      setStatus(`Could not copy AI starter prompt: ${e?.message || String(e)}`);
    }
  }

  async function handleDeleteCollection(collectionName: string) {
    const key = String(collectionName || "").trim() || "Ungrouped";
    try {
      const rules = [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler].filter((rule) => collectionNameOf(rule) !== key);
      const nextPack = normalizeCustomRulePack({ rules });
      await persistGlobalCustomRules(nextPack);
      HIDDEN_COLLECTIONS.delete(key)
      await persistHiddenCollections()
      if (selectedCollectionFilter === key) setSelectedCollectionFilter("all");
      setStatus(`Deleted collection "${key}".`);
    } catch (e: any) {
      setStatus(`Could not delete collection: ${e?.message || String(e)}`);
    }
  }


  async function handleToggleHiddenRule(rule: { key: string; title: string; kind: "serious" | "filler" }) {
    try {
      if (HIDDEN_RULE_KEYS.has(rule.key)) HIDDEN_RULE_KEYS.delete(rule.key);
      else HIDDEN_RULE_KEYS.add(rule.key);
      await persistHiddenRules();
      setHiddenRuleVersion((v) => v + 1);
      setStatus(`${rule.title} is now ${HIDDEN_RULE_KEYS.has(rule.key) ? "hidden" : "visible"} in Cranky Vince runs.`);
      if (state?.selectedPromotionId && typeof window !== "undefined" && window.confirm("Rule visibility changed. Rebuild the current deck now?")) {
        await rebuildDeckForPromotion(state.selectedPromotionId);
      }
    } catch (e: any) {
      setStatus(`Could not update hidden rule list: ${e?.message || String(e)}`);
    }
  }


  function builtInStarterText(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string } | null) {
    if (!rule) return "Write your custom Cranky Vince rule text here.";
    const key = String(rule.key || "").trim();

    const byKey: Record<string, string> = {
      brand_jump: "{worker1} must spend the next month teasing a jump from {promotion} to {otherPromotion}, even though management has no real intention of letting it happen.",
      title_vs_title: "The main event is {worldTitle} versus {midcardTitle} with one clear winner.",
      unlikely_tag: "{worker1} and {worker2} must immediately become a tag team after colliding last week.",
      can_they_coexist: "{worker1} and {worker2} must become reluctant tag champions for at least two months.",
      commentary_match: "The commentary team are forced into a match with the reigning {worldTitle} holder to defend their jobs.",
      hell_in_cell: "There must be a Hell In A Cell match on the show, and it must have a clean finish.",
      production_truck: "{worker1} must cause havoc in the production truck.",
      all_titles_change: "Every active {initials} championship must change hands on the same night.",
      time_traveler: "{worker1} must debut a brand new time-traveler gimmick on the next {initials} show.",
      top_losing_streak: "{topWorker} must go on a losing streak despite being in the top five most popular stars in {initials}.",
      women_only_show: "Your next {initials} show is an all-women special. No men allowed in the ring.",
      least_over_world_title: "{leastOverWorker} must end this challenge as the reigning {worldTitle}.",
      oldest_world_title: "{oldestWorker} must capture {worldTitle} and hold it for at least six months.",
      least_vs_most: "{leastOverWorker} must feud with {topWorker}.",
      five_masks: "At least five established {initials} workers must don masks immediately.",
      travel_issues: "Travel has collapsed. Roughly 60% of the {initials} roster is stuck abroad and cannot appear on the next show.",
      all_cage: "Every match on your next {initials} show must be contested inside a cage.",
      double_turn: "{worker1} and {worker2} must both flip alignment on the same show, even if it makes no sense.",
      heat_from_office: "{topWorker} must job to a lower-card worker after management gets annoyed, and if a title is involved it must change hands.",
      one_fan_hired: "A fan must jump the barrier, attack {worker1}, and be rewarded with a contract.",
      barrier_breach: "A fan must jump the barrier, attack {worker1}, and be rewarded with a contract.",
      authority_romance: "{femaleWorker1} must spend the next month abusing management power in pursuit of {maleWorker1}.",
      relationship_angle: "{femaleWorker1} and {maleWorker1} must begin a REALISTIC, deeply melodramatic relationship angle.",
      realistic_relationship: "{femaleWorker1} and {maleWorker1} must begin a REALISTIC, deeply melodramatic relationship angle.",
      world_hot_potato: "{worldTitle} must change hands on back-to-back shows.",
      title_race_to_bottom: "{worker1} must capture {midcardTitle}.",
      world_musical: "{initials}: The Musical. Your next show must lean into it shamelessly.",
      weekly_rerun_feud: "{worker1} and {worker2} must wrestle each other repeatedly for two months without either scoring one decisive win.",
      movie_synergy: "The next {initials} show must revolve around a fake blockbuster starring {topWorker}.",
      pet_gimmick: "{worker1} must introduce a new pet or animal as an essential part of the gimmick.",
      retirement_loss: "{oldestWorker} must declare retirement after one more loss, and that loss will happen.",
      all_multiman: "Your next {initials} show must be wall-to-wall multi-person chaos so as many workers as possible can wrestle.",
      old_timer_guest_ref: "{worker1} must feud with an old-timer for a month before the blowoff becomes a guest-referee match.",
      title_hot_potato: "{worldTitle} must change hands repeatedly until the belt means absolutely nothing.",
      magician_title_retire: "{developmental1} debuts as a magician and makes {midcardTitle} disappear for good.",
      free_agents_group: "{freeAgent1}, {freeAgent2}, and {freeAgent3} must be signed and debuted as a new group.",
      developmental_upset: "{developmental1} must debut and defeat {topWorker} immediately.",
      sponsor_match: "At least one match on the next {initials} show must shamelessly exist to advertise a sponsor.",

      diet_soda: "This month's main feud in {initials} is now entirely about somebody spilling another person's diet soda.",
      all_nonfinish: "Every match on the next {initials} show must end in a count-out, DQ, or non-finish.",
      drop_toe_hold_death: "{worker1} debuts a drop toe hold that commentary sells like a near-fatal war crime.",
      barbershop_quartet: "{worker1}, {worker2}, {worker3}, and {maleWorker1} are now a barbershop singer stable and must perform during matches.",
      canadian_purge: "A politician insults pro wrestling in a speech, so management retaliates by firing every Canadian in {initials}.",
      postal_worker: "{worker1} must adopt a postal worker gimmick and deliver love letters on every show.",
      all_sponsors: "Every segment on the next {initials} show must somehow revolve around a sponsor activation.",
      authority_figure: "{femaleWorker1} becomes authority figure for one night and abuses the power wildly.",
      game_show: "{worker1} becomes a game show host and will only defend a title against people who can answer trivia questions.",
      alien_abduction: "{worker1} gets abducted by aliens.",
      hot_dog_pole: "{worker1} and {worker2} feud over hot dogs for two months before a Hot Dog on a Pole match.",
      musical_week: "For one full week, {initials} becomes an all-singing, all-dancing musical.",
      trampoline_match: "A match must take place on a trampoline.",
      star_trek_parody: "Your main event is replaced by a Star Trek parody skit starring {worker1} and as many other workers as possible.",
      mini_golf: "{worker1} must now feud over mini-golf supremacy.",
      live_sex_celebration: "{initials} brings back the Live Sex Celebration, because clearly that is the answer.",
      lounge_lizards: "Introduce a stable of lounge lizard swing singers into {initials}. They are now a major act.",
      reality_show: "A month-long reality-show segment debuts on {initials}, starring wrestlers who should never live together.",
      brawl_4_all: "Brawl 4 All. No further explanation will be provided.",
      random_ref: "{worker1} must become the special referee for the entire show and ruin every finish.",

      announcer_bias: "One announcer must openly root for a specific wrestler all night and nobody is allowed to stop it.",
      ring_prop: "A completely pointless prop must become central to a major angle.",
      mystery_box: "A mysterious box must appear on the show and its eventual contents should somehow be more disappointing than expected.",
      terrible_makeover: "{worker1} must get an ill-advised makeover live on television.",
      broken_music: "Somebody's entrance music must be changed to something profoundly embarrassing on the next {initials} show.",
      guest_host: "{worker1} must somehow end up hosting a chunk of the show.",
      mascot_match: "A mascot, costume character, or similarly undignified figure must get physically involved in a match.",
      forced_poetry: "{worker1} must cut a poem instead of a normal promo.",
      backstage_tour: "A lengthy backstage skit must waste everybody's time and still somehow be treated like essential television.",
      wheel_of_stips: "A wheel or randomizer must decide a match stipulation, and the result should be ridiculous.",
      celebrity_name_drop: "The broadcast must repeatedly mention a celebrity, movie, or sponsor that has almost nothing to do with wrestling.",
      giant_birthday: "{worker1} must be forced into a painfully long birthday or celebration segment.",
      awkward_dance: "{worker1} must dance on the show, whether the audience wants it or not.",
      parking_lot: "A major confrontation must spill into a parking lot because subtlety is dead.",
      conspiracy_board: "{worker1} must unveil an absurd conspiracy theory complete with visual aids.",
      food_fight: "A feud must escalate through a food fight, catering brawl, or other deeply unserious workplace incident.",
      dramatic_reading: "{worker1} must deliver a dramatic reading of something that should never have been written.",
      terrible_merch: "Management insists on pushing a terrible piece of merchandise as if it will save the quarter.",
      camera_chaos: "Production must miss something important and pretend it was intentional.",
      vague_prophecy: "{worker1} must cut a promo that sounds profound but means absolutely nothing.",
      understudy: "Somebody must be replaced at the last second by an obviously worse substitute.",
      mercy_rule: "An authority figure must randomly end a match or segment early for reasons that make no real sense.",
      social_media: "A storyline beat must be justified entirely through the vague promise that it will trend online.",
      surprise_return: "A former {initials} name or very old veteran must return for a pop and immediately complicate everything.",
      brand_summit: "Management demands an emergency summit segment on the next {initials} show that solves nothing.",

      // Generic gimmick pivots
      gimmick_1: "{worker1} must abruptly repackage as Savage.",
      gimmick_2: "{worker1} must abruptly repackage as Cocky.",
      gimmick_3: "{worker1} must abruptly repackage as Cowardly.",
      gimmick_4: "{worker1} must abruptly repackage as Bad Ass."
    };

    if (byKey[key]) return byKey[key];
    if (key.startsWith("gimmick_")) return "{worker1} must abruptly repackage under a brand new gimmick pivot and management expects everyone to pretend it was always the plan.";

    const title = rule.title;
    const byTitle: Record<string, string> = {
      "Conspiracy Promo": "{worker1} must unveil a full-blown conspiracy promo complete with diagrams, accusations, and evidence that should absolutely not hold up under scrutiny.",
      "Corporate Integration": "Every segment on the next {initials} show must somehow revolve around a sponsor activation or shameless corporate tie-in.",
      "Diet Soda Disaster": "This month's main feud in {initials} is now entirely about somebody spilling another person's diet soda.",
      "Mail Call": "{worker1} must adopt a postal worker gimmick and deliver letters, warnings, or emotional damage on every show.",
      "Power Imbalance": "{femaleWorker1} must spend the next month abusing management power in pursuit of {maleWorker1}.",
      "Time Traveler": "{worker1} must debut a brand new time-traveler gimmick on the next {initials} show.",
      "Night of Upheaval": "Every active {initials} championship must change hands on the same night.",
      "World Hot Potato": "{worldTitle} must change hands on back-to-back shows.",
      "Movie Tie-In": "A show is dedicated to promoting a new movie starring {worker1}, whether the audience cares or not.",
      "Needless Return": "A former {initials} name or aging veteran must return for a cheap pop and immediately complicate everything.",
      "Prophetic Nonsense": "{worker1} must cut a promo that sounds profound, ominous, and completely meaningless.",
      "Winner Takes More": "The main event is {worldTitle} versus {midcardTitle} with one clear winner.",
      "Instant Team": "{worker1} and {worker2} must immediately become a tag team after colliding last week.",
      "Can They Co-Exist?": "{worker1} and {worker2} must become reluctant tag champions for at least two months.",
      "Hell In A Cell": "There must be a Hell In A Cell match on the show, and it must have a clean finish.",
      "Truck Trouble": "{worker1} must cause havoc in the production truck.",
      "Barrier Breach": "A fan must jump the barrier, attack {worker1}, and be rewarded with a contract.",
      "One Last Run": "{oldestWorker} must capture {worldTitle} and hold it for at least six months.",
      "Pet Project": "{worker1} must introduce a new pet or animal as an essential part of the gimmick.",
      "The Musical": "{initials}: The Musical. Your next show must lean into it shamelessly.",
      "Birthday Segment": "{worker1} must be forced into a painfully long birthday or celebration segment.",
      "Bounce House": "A match must take place on a trampoline.",
      "Brawl 4 All": "Brawl 4 All. No further explanation will be provided.",
      "Broadcast Vendetta": "One announcer must openly root for a specific wrestler all night and nobody is allowed to stop it.",
      "Commentary in Crisis": "The commentary team are forced into a match with the reigning {worldTitle} holder to defend their jobs.",
      "Completely Realistic Romance": "{femaleWorker1} and {maleWorker1} must begin a REALISTIC, deeply melodramatic relationship angle.",
      "Corporate Synergy": "The next {initials} show must revolve around a fake blockbuster starring {topWorker}.",
      "Needless Prop": "A completely pointless prop must become central to a major angle.",
      "Mystery Box": "A mysterious box must appear on the show and its eventual contents should somehow be more disappointing than expected.",
      "Makeover Segment": "{worker1} must get an ill-advised makeover live on television.",
      "Wrong Theme Song": "Somebody's entrance music must be changed to something profoundly embarrassing on the next {initials} show.",
      "Guest Host Energy": "{worker1} must somehow end up hosting a chunk of the show.",
      "Mascot Involvement": "A mascot, costume character, or similarly undignified figure must get physically involved in a match.",
      "Poetry Slam": "{worker1} must cut a poem instead of a normal promo.",
      "Guided Tour": "A lengthy backstage skit must waste everybody's time and still somehow be treated like essential television.",
      "Spin the Wheel": "A wheel or randomizer must decide a match stipulation, and the result should be ridiculous.",
      "Synergy Mention": "The broadcast must repeatedly mention a celebrity, movie, or sponsor that has almost nothing to do with wrestling.",
      "Dance Break": "{worker1} must dance on the show, whether the audience wants it or not.",
      "Parking Lot Business": "A major confrontation must spill into a parking lot because subtlety is dead.",
      "Catering Catastrophe": "A feud must escalate through a food fight, catering brawl, or other deeply unserious workplace incident.",
      "Dramatic Reading": "{worker1} must deliver a dramatic reading of something that should never have been written.",
      "Merch Push": "Management insists on pushing a terrible piece of merchandise as if it will save the quarter.",
      "Cut to Black": "Production must miss something important and pretend it was intentional.",
      "Replacement Wrestler": "Somebody must be replaced at the last second by an obviously worse substitute.",
      "Mercy Rule": "An authority figure must randomly end a match or segment early for reasons that make no real sense.",
      "Trending Now": "A storyline beat must be justified entirely through the vague promise that it will trend online.",
      "Emergency Summit": "Management demands an emergency summit segment on the next {initials} show that solves nothing."
    };

    if (byTitle[title]) return byTitle[title];

    const rawSample = resolveBuiltInRuleSample(rule).trim();
    if (rawSample) return rawSample;

    const placeholderizedFromLiveSample = placeholderStarterFromBuiltIn(rule);
    if (placeholderizedFromLiveSample) return placeholderizedFromLiveSample;

    return `No starter template has been defined yet for "${title}".`;
  }

  function selectedBuiltInTemplate(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string } | null) {
    const safeKey = String(rule?.title ?? "new_rule")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "new_rule";
    return JSON.stringify({
      rules: [
        {
          key: `custom_${safeKey}`,
          title: rule?.title ?? "New Custom Rule",
          kind: rule?.kind ?? "serious",
          text: builtInStarterText(rule),
          collection: "",
          notBefore: rule?.notBefore || "",
          notAfter: rule?.notAfter || "",
          requirements: {}
        }
      ]
    }, null, 2);
  }

  function syncCustomRulesState(pack = CUSTOM_RULE_PACK) {
    setCustomRulesListState([...(pack?.serious || []), ...(pack?.filler || [])]);
  }

  function customRulesForList() {
    const rows = [...customRulesListState];
    return rows.sort((a, b) => {
      const ac = String(a.collection || "").toLowerCase();
      const bc = String(b.collection || "").toLowerCase();
      if (ac !== bc) return ac.localeCompare(bc);
      const ak = String(a.kind || "serious");
      const bk = String(b.kind || "serious");
      if (ak !== bk) return ak.localeCompare(bk);
      return String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    });
  }

  function groupedCustomRulesForList() {
    const rows = customRulesForList();
    const groups = new Map<string, CustomRuleSpec[]>();
    rows.forEach((rule) => {
      const key = collectionNameOf(rule);
      if (selectedCollectionFilter !== "all" && key !== selectedCollectionFilter) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rule);
    });
    return [...groups.entries()];
  }

  function collectionOptions() {
    const all = [...new Set(customRulesForList().map((rule) => collectionNameOf(rule)))];
    return all.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  function selectedCustomRuleTemplate(rule: CustomRuleSpec | null) {
    return JSON.stringify({
      rules: rule ? [rule] : [
        {
          key: "custom_new_rule",
          title: "New Custom Rule",
          kind: "serious",
          text: "Write your custom Cranky Vince rule text here.",
          collection: "",
          notBefore: "",
          notAfter: "",
          requirements: {}
        }
      ]
    }, null, 2);
  }

  function handleUseBuiltInRuleTemplate(rule: { key?: string; title: string; kind: "serious" | "filler"; sampleText?: string; notBefore?: string; notAfter?: string }) {
    setSelectedBuiltInRule(rule);
    setSelectedCustomRuleKey(null);
    setEditorViewMode("standard");
    setCustomRulesText(selectedBuiltInTemplate(rule));
    setCustomRulesError("");
    setStatus(`Loaded "${rule.title}" into the editor as a starter template.`);
  }

  function handleViewCustomRule(rule: CustomRuleSpec) {
    setSelectedBuiltInRule(null);
    setSelectedViewedCustomRuleKey(rule.key);
    setStatus(`Viewing custom rule "${rule.title}".`);
  }

  function handleEditCustomRule(rule: CustomRuleSpec) {
    setSelectedBuiltInRule(null);
    setSelectedViewedCustomRuleKey(rule.key);
    setSelectedCustomRuleKey(rule.key);
    setEditorViewMode("standard");
    setCustomRulesText(selectedCustomRuleTemplate(rule));
    setCustomRulesError("");
    setStatus(`Loaded custom rule "${rule.title}" into the editor.`);
  }

  function handleNewCustomRule(kind: "serious" | "filler" = "serious") {
    setSelectedBuiltInRule(null);
    setSelectedViewedCustomRuleKey(null);
    setSelectedCustomRuleKey(null);
    setEditorViewMode("standard");
    setCustomRulesText(JSON.stringify({
      rules: [
        {
          key: `custom_${kind}_rule`,
          title: kind === "filler" ? "New Custom Chaos Rule" : "New Custom Rule",
          kind,
          text: kind === "filler"
            ? "{worker1} must become the center of a completely unnecessary chaos segment on the next {initials} show."
            : "{worker1} must become central to a booking disaster on the next {initials} show.",
          collection: "",
          notBefore: "",
          notAfter: "",
          requirements: {}
        }
      ]
    }, null, 2));
    setCustomRulesError("");
  }

  async function _handleImportCustomRules() {
  void _handleImportCustomRules;

    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (!picked || Array.isArray(picked)) return;
      const raw = textFile(await readFile(String(picked)));
      const parsed = JSON.parse(raw || '{"rules":[]}');
      await persistGlobalCustomRules(normalizeCustomRulePack(parsed));
      setEditorViewMode("code");
      setSelectedCustomRuleKey(null);
      setCustomRulesText(JSON.stringify(parsed, null, 2));
      setCustomRulesError("");
      setStatus(`Imported custom rule pack from ${String(picked).split(/[\\/]/).pop() || picked}.`);
    } catch (e: any) {
      setCustomRulesError(e?.message || String(e));
      setStatus(`Could not import global custom rule pack: ${e?.message || String(e)}`);
    }
  }

  async function _handleExportCustomRules() {
  void _handleExportCustomRules;

    try {
      const parsed = JSON.parse(customRulesText || '{"rules":[]}');
      const importedPack = normalizeCustomRulePack(parsed);
      CUSTOM_RULE_PACK = importedPack;
      syncCustomRulesState(importedPack);
      const out = await save({
        defaultPath: "cranky_vince_rules_export.json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (!out) return;
      await writeFile(String(out), encodeText(JSON.stringify(parsed, null, 2)));
      setCustomRulesError("");
      setStatus(`Exported custom rule pack to ${String(out).split(/[\\/]/).pop() || out}.`);
    } catch (e: any) {
      setCustomRulesError(e?.message || String(e));
      setStatus(`Could not export custom rule pack: ${e?.message || String(e)}`);
    }
  }

  async function loadCustomRulesEditor() {
    try {
      const path = customRulesRegistryPath();
      if (path && await exists(path)) {
        const raw = textFile(await readFile(path));
        const nextPack = normalizeCustomRulePack(JSON.parse(raw || '{"rules":[]}'));
        CUSTOM_RULE_PACK = nextPack;
        syncCustomRulesState(nextPack);
        setEditorViewMode("standard");
        setCustomRulesText(raw || serializeCurrentCustomRules());
      } else {
        const nextPack = readGlobalCustomRulesFromStorage();
        CUSTOM_RULE_PACK = nextPack;
        syncCustomRulesState(nextPack);
        setEditorViewMode("standard");
        setCustomRulesText(serializeCurrentCustomRules());
      }
      setSelectedCustomRuleKey(null);
      setCustomRulesError("");
    } catch (e: any) {
      const nextPack = readGlobalCustomRulesFromStorage();
      CUSTOM_RULE_PACK = nextPack;
      syncCustomRulesState(nextPack);
      setCustomRulesText(serializeCurrentCustomRules());
      setCustomRulesError(`Could not load global custom rules file: ${e?.message || String(e)}`);
    }
  }

  async function handleSaveCustomRules() {

    try {
      let pack;
      try {
        const parsed = JSON.parse(customRulesText || '{"rules":[]}');
        pack = normalizeCustomRulePack(parsed);
      } catch {
        const editorRule = currentEditorRule();
        pack = normalizeCustomRulePack({ rules: [editorRule] });
      }
      let singleRule = [...pack.serious, ...pack.filler][0];
      if (!singleRule) throw new Error("Create or load one rule first.");
      const existing = CUSTOM_RULE_PACK ? [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler] : [];
      const resolvedKey = buildUniqueCustomRuleKey(singleRule, existing, selectedCustomRuleKey);
      singleRule = { ...singleRule, key: resolvedKey };
      const merged = [singleRule, ...existing.filter((rule) => String(rule.key) !== String(selectedCustomRuleKey || singleRule.key))];
      const nextPack = normalizeCustomRulePack({ rules: merged });
      await persistGlobalCustomRules(nextPack);
      setSelectedViewedCustomRuleKey(singleRule.key);
      setSelectedCustomRuleKey(null);
      setSelectedBuiltInRule(null);
      setEditorViewMode("standard");
      setCustomRulesText(selectedCustomRuleTemplate(null));
      setCustomRulesError("");
      setStatus(`Saved custom rule "${singleRule.title}" to the global custom rule pack. Pack now has ${nextPack.serious.length} serious and ${nextPack.filler.length} filler rules. The editor has been reset for a new rule. Use Rebuild Current Deck in Cranky Vince Options when you want the active deck to pull from the updated rule pool.`);
    } catch (e: any) {
      setCustomRulesError(e?.message || String(e));
      setStatus(`Custom rule is invalid: ${e?.message || String(e)}`);
    }
  }

  async function handleDeleteCustomRule(ruleKey: string) {
    try {
      const remaining = [...CUSTOM_RULE_PACK.serious, ...CUSTOM_RULE_PACK.filler].filter((rule) => String(rule.key) !== String(ruleKey));
      const nextPack = normalizeCustomRulePack({ rules: remaining });
      await persistGlobalCustomRules(nextPack);
      if (selectedCustomRuleKey === ruleKey) {
        setSelectedCustomRuleKey(null);
        setCustomRulesText(selectedCustomRuleTemplate(null));
      }
      if (selectedViewedCustomRuleKey === ruleKey) {
        setSelectedViewedCustomRuleKey(null);
      }
      setCustomRulesError("");
      setStatus("Custom rule deleted.");
    } catch (e: any) {
      setCustomRulesError(e?.message || String(e));
      setStatus(`Could not delete custom rule: ${e?.message || String(e)}`);
    }
  }

  async function _handleClearCustomRules() {
  void _handleClearCustomRules;

    try {
      const path = customRulesRegistryPath();
      if (path) {
        try { await remove(path); } catch {}
      }
      try {
        if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(CUSTOM_RULES_STORAGE_KEY);
      } catch {}
      CUSTOM_RULE_PACK = { serious: [], filler: [] };
      syncCustomRulesState(CUSTOM_RULE_PACK);
      setSelectedCustomRuleKey(null);
      setSelectedViewedCustomRuleKey(null);
      setCustomRulesText(selectedCustomRuleTemplate(null));
      setCustomRulesError("");
      setStatus("Global custom Cranky Vince rule pack cleared. Use Rebuild Current Deck in Cranky Vince Options if you want the active deck refreshed now.");
    } catch (e: any) {
      setCustomRulesError(e?.message || String(e));
      setStatus(`Could not clear custom rules: ${e?.message || String(e)}`);
    }
  }

  async function loadUniverse(root: string) {
    const promosBytes = await readFile(`${root}/promos.dat`);
    const wrestlerBytes = await readFile(`${root}/wrestler.dat`);
    const beltExists = await exists(`${root}/belt.dat`);
    const beltBytes = beltExists ? await readFile(`${root}/belt.dat`) : new Uint8Array();
    const gameInfoExists = await exists(`${root}/gameinfo.dat`);
    const gameInfoBytes = gameInfoExists ? await readFile(`${root}/gameinfo.dat`) : new Uint8Array();
    try {
      const globalPack = readGlobalCustomRulesFromStorage();
      CUSTOM_RULE_PACK = globalPack;
      syncCustomRulesState(globalPack);
    } catch {
      CUSTOM_RULE_PACK = { serious: [], filler: [] };
      syncCustomRulesState(CUSTOM_RULE_PACK);
    }
    try {
      const hiddenRulesPath = hiddenRulesRegistryPath(root);
      if (hiddenRulesPath && await exists(hiddenRulesPath)) {
        const hiddenRaw = JSON.parse(textFile(await readFile(hiddenRulesPath)));
        HIDDEN_RULE_KEYS = new Set(Array.isArray(hiddenRaw?.hiddenRuleKeys) ? hiddenRaw.hiddenRuleKeys.map((v: any) => String(v)) : []);
      } else {
        HIDDEN_RULE_KEYS = new Set();
      }
    } catch {
      HIDDEN_RULE_KEYS = new Set();
    }
    try {
      const hiddenCollectionsPath = hiddenCollectionsRegistryPath(root);
      if (hiddenCollectionsPath && await exists(hiddenCollectionsPath)) {
        const hiddenCollectionsRaw = JSON.parse(textFile(await readFile(hiddenCollectionsPath)));
        HIDDEN_COLLECTIONS = new Set(Array.isArray(hiddenCollectionsRaw?.hiddenCollections) ? hiddenCollectionsRaw.hiddenCollections.map((v: any) => String(v)) : []);
      } else {
        HIDDEN_COLLECTIONS = new Set();
      }
    } catch {
      HIDDEN_COLLECTIONS = new Set();
    }
    const promosParsed = parsePromosDat(promosBytes);
    const recordMap = new Map<number, PromoRecord>(promosParsed.records.map((r) => [Number(r.id), r]));
    const promotions: PromoContext[] = promosParsed.promos.map((p) => ({
      ...p,
      initials: String(recordMap.get(Number(p.id))?.initials || p.shortName || p.name).trim(),
      sizeRaw: Number(recordMap.get(Number(p.id))?.size || 0),
    }));
    promotions.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const workers = parseWrestlerDat(toArrayBuffer(wrestlerBytes));
    const belts = parseBeltDat(beltBytes);
    const currentDateIso = gameInfoBytes.length ? parseGameInfoCurrentDate(gameInfoBytes) : "";
    return { saveRoot: root, promotions, workers, belts, currentDateIso } as UniverseSnapshot;
  }

  async function _loadOrCreateState(root: string, snap: UniverseSnapshot) {
  void _loadOrCreateState;

    const path = stateRegistryPath(root);
    if (path && await exists(path)) {
      try {
        const parsed = JSON.parse(textFile(await readFile(path))) as CrankyState;
        if (parsed?.version === STATE_VERSION && Array.isArray(parsed?.activeDeck)) return parsed;
      } catch {}
    }
    const fresh = defaultState(snap);
    await persistState(fresh, root);
    return fresh;
  }

  async function handleSelectSaveFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Choose EWR Save Folder" });
    if (!picked || typeof picked !== "string") return;
    try {
      await loadSaveFolderContext(picked);
    } catch (e: any) {
      console.error(e);
      setStatus(`Failed to load save folder: ${e?.message || String(e)}`);
    }
  }

  async function handleReloadSave() {
    if (!saveRoot) return;
    setIsReloading(true);
    try {
      const snap = await loadUniverse(saveRoot);
      setUniverse(snap);
      await loadCustomRulesEditor();

      if (!state) {
        setUniverse(snap);
        setSelectedHistoryIndex(null);
        setStatus(`Save data reloaded for ${saveRoot.split(/[\/]/).pop() || saveRoot}. No Cranky Vince state is currently loaded.`);
      } else {
        const fallbackPromoId = Number(snap.promotions[0]?.id || 0);
        const selectedPromotionId = snap.promotions.some((promo) => Number(promo.id) == Number(state.selectedPromotionId))
          ? Number(state.selectedPromotionId)
          : fallbackPromoId;
        const next = { ...state, selectedPromotionId };
        setState(next);
        if (selectedHistoryIndex !== null && selectedHistoryIndex >= next.history.length) {
          setSelectedHistoryIndex(next.history.length ? 0 : null);
        }
        await persistState(next);
        await rememberSession(saveRoot, next, snap);
        setStatus(`Save data reloaded for ${saveRoot.split(/[\\/]/).pop() || saveRoot}. Existing deck, week progress, and reveal history were preserved. Loaded ${CUSTOM_RULE_PACK.serious.length} custom serious rules and ${CUSTOM_RULE_PACK.filler.length} custom filler rules.`);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`Reload failed: ${e?.message || String(e)}`);
    } finally {
      setIsReloading(false);
    }
  }


  function handleCloseSession() {
    setSaveRoot("");
    setUniverse(null);
    setState(null);
    setSelectedHistoryIndex(null);
    setSelectedBuiltInRule(null);
    setSelectedCustomRuleKey(null);
    setOptionsOpen(false);
    setStatus("Cranky Vince session closed.");
  }

  async function handleDeleteState() {
    if (!saveRoot) return;
    try {
      try {
        const path = stateRegistryPath(saveRoot);
        if (path) await remove(path);
      } catch {}
      setState(null);
      setSelectedHistoryIndex(null);
      setSelectedBuiltInRule(null);
      setOptionsOpen(false);
      setStatus("Cranky Vince state file deleted. No state is loaded now. Use Rebuild Current Deck when you want to create a new state.");
    } catch (e: any) {
      console.error(e);
      setStatus(`Delete state failed: ${e?.message || String(e)}`);
    }
  }

  async function rebuildDeckForPromotion(promoId: number) {
    if (!universe) return;
    const next = defaultState(universe, promoId, state?.history || []);
    setState(next);
    setSelectedHistoryIndex(null);
    await persistState(next);
    await rememberSession(saveRoot, next, universe);
    setStatus(`Deck rebuilt for ${promotionInitials(universe.promotions, promoId)} with ${next.seriousCount} serious cards and ${next.fillerCount} filler cards.`);
  }

  async function handleDrawFive() {
    if (!state) return;
    if (state.offeredCards.length) { setStatus("Five cards are already on the table."); return; }
    if (state.chosenCard) { setStatus("Advance the week before drawing again."); return; }
    const taken = state.activeDeck.slice(0, 5);
    if (!taken.length) { setStatus("No cards remain in the active deck."); return; }
    const next = { ...state, offeredCards: taken, activeDeck: state.activeDeck.slice(taken.length) };
    setState(next);
    await persistState(next);
    await rememberSession(saveRoot, next, universe!);
    setStatus(`Five cards drawn for week ${state.week}. Pick one.`);
  }

  async function handleRevealCard(slotId: string) {
    if (!state || !state.offeredCards.length || state.chosenCard) return;
    const chosen = state.offeredCards.find((card) => card.slotId === slotId);
    if (!chosen) return;
    const returns = shuffle(state.offeredCards.filter((card) => card.slotId !== slotId));
    const next: CrankyState = {
      ...state,
      activeDeck: shuffle([...state.activeDeck, ...returns]),
      offeredCards: [],
      chosenCard: chosen,
      history: [{ week: state.week, slotId: chosen.slotId, ruleKey: chosen.ruleKey, title: chosen.title, text: chosen.text, kind: chosen.kind }, ...state.history].slice(0, 30),
    };
    setState(next);
    setSelectedHistoryIndex(0);
    await persistState(next);
    await rememberSession(saveRoot, next, universe!);
    setStatus(`Rule revealed for week ${state.week}.`);
  }

  async function handleAdvanceWeek() {
    if (!state || !universe) return;
    if (!state.chosenCard) { setStatus("Reveal a card before advancing the week."); return; }
    if (state.week >= 10) {
      const next = defaultState(universe, state.selectedPromotionId, state.history);
      next.sessionName = state.sessionName || next.sessionName;
      next.history = state.history;
      setState(next);
      await persistState(next);
      await rememberSession(saveRoot, next, universe);
      const resetMessage = `Congratulations. You somehow made it through ten weeks under these stressful conditions. Time to shuffle the deck and test your patience even more for ${promotionInitials(universe.promotions, state.selectedPromotionId)}.`;
      setStatus(resetMessage);
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(resetMessage);
      }
      return;
    }
    const next = { ...state, week: state.week + 1, offeredCards: [], chosenCard: null };
    setState(next);
    await persistState(next);
    await rememberSession(saveRoot, next, universe);
    setStatus(`Advanced to week ${next.week}.`);
  }

  const selectedPromo = universe && state ? promoById(universe.promotions, state.selectedPromotionId) : null;
  const visibleCards = state?.offeredCards.length ? state.offeredCards : state?.chosenCard ? [state.chosenCard] : [];
  const showAnyCards = visibleCards.length > 0;
    const deckBackVisible = !!state && !state.chosenCard && !state.offeredCards.length && state.activeDeck.length > 0;
  const selectedRuleWeek = chosenHistory?.week ?? state?.week ?? 1;
  const drawDisabled = !state || !universe || !!state.offeredCards.length || !!state.chosenCard;
  const header = (
    <EditorHeader
      title="Cranky Vince"
      leftPills={[saveRoot ? `Save: ${saveRoot.split(/[\\/]/).pop() || saveRoot}` : "No save loaded", state ? `Week ${state.week} / 10` : "No state loaded"]}
      rightPills={status ? [status] : undefined}
    />
  );

  return (
    <div className="ewr-app">
      <div className="ewr-panel ewr-left">
        <div style={{ padding: "12px 14px 0", display: "grid", gap: 10 }}>
          <div className="ewr-leftContext" style={{ minWidth: 0 }}>
            <div className="ewr-leftContextTitle">Cranky Vince</div>
            <div className="ewr-leftContextSub">Rule Generator</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              className="ewr-button ewr-buttonLightBlue"
              style={{ minHeight: 56, width: "100%", minWidth: 0, paddingInline: 10 }}
              onClick={handleSelectSaveFolder}
            >
              <IconFolderOpen className="btnSvg" />
              <span className="btnText" style={{ whiteSpace: "normal", lineHeight: 1.1, textAlign: "center" }}>Select Save Folder</span>
            </button>

            <button
              type="button"
              className={`ewr-button ewr-buttonOrange ${!saveRoot || isReloading ? "ewr-buttonDisabled" : ""}`}
              style={{ minHeight: 56, width: "100%", minWidth: 0, paddingInline: 10, background: "linear-gradient(180deg, #f7a21b 0%, #d97b00 100%)", borderColor: "rgba(255,190,90,0.75)" }}
              onClick={handleReloadSave}
              disabled={!saveRoot || isReloading}
            >
              <span className="btnSvg" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "rgba(255,255,255,0.95)", animation: isReloading ? "spin 0.8s linear infinite" : "none", display: "inline-block" }} />
              </span>
              <span className="btnText" style={{ whiteSpace: "normal", lineHeight: 1.1, textAlign: "center" }}>{isReloading ? "Reloading..." : "Reload State"}</span>
            </button>

            <button
              type="button"
              className={`ewr-button ewr-buttonRed ${!saveRoot || !universe ? "ewr-buttonDisabled" : ""}`}
              style={{ minHeight: 56, width: "100%", minWidth: 0, paddingInline: 10, background: "linear-gradient(180deg, rgba(120,20,20,0.98) 0%, rgba(80,10,10,0.98) 100%)", borderColor: "rgba(255,90,90,0.55)" }}
              onClick={handleDeleteState}
              disabled={!saveRoot || !universe}
            >
              <IconSave className="btnSvg" />
              <span className="btnText" style={{ whiteSpace: "normal", lineHeight: 1.1, textAlign: "center" }}>Delete State</span>
            </button>

            <button
              type="button"
              className="ewr-button ewr-buttonRed"
              style={{ minHeight: 56, width: "100%", minWidth: 0, paddingInline: 10 }}
              onClick={handleCloseSession}
              disabled={!saveRoot && !state && !universe}
            >
              <span className="btnText" style={{ whiteSpace: "normal", lineHeight: 1.1, textAlign: "center" }}>Close Session</span>
            </button>
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", marginTop: 2 }} />
        </div>
        <div className="ewr-leftMiddle ewr-scroll">
          <div className="ewr-leftBody" style={{ display: "grid", gap: 12 }}>
            <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
              <div className="ewr-sectionTitle" style={{ margin: 0 }}>Save Setup</div>
              <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                Select a save folder to unleash Cranky Vince. Era-limited rules compare against the save's Current Date in gameinfo.dat before they are allowed into the deck.
              </div>
              {universe?.currentDateIso ? <div className="ewr-pill" style={{ justifySelf: "start", padding: "5px 9px", fontSize: 11 }}>Current Date {universe.currentDateIso}</div> : null}
            </div>
            <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
              <div className="ewr-sectionTitle" style={{ margin: 0 }}>Promotion Context</div>
              <select className="ewr-input" value={state?.selectedPromotionId ?? 0} onChange={(e) => rebuildDeckForPromotion(Number(e.target.value) || 0)} disabled={!universe?.promotions.length}>
                {([...((universe?.promotions ?? []))].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((promo) => <option key={promo.id} value={promo.id}>{promo.name}</option>))}
              </select>
              <div className="ewr-muted" style={{ fontSize: 12 }}>
                Locked Deck: {state?.seriousCount ?? 0} serious cards + {state?.fillerCount ?? 0} filler chaos cards.
              </div>
              <div className="ewr-muted" style={{ fontSize: 12 }}>
                Cards remaining: {state?.activeDeck.length ?? 0} • Offered: {state?.offeredCards.length ?? 0} • History: {state?.history.length ?? 0}
              </div>
            </div>
            <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10, overflowX: "hidden" }}>
              <div className="ewr-sectionTitle" style={{ margin: 0 }}>Save Sessions</div>
              {!saveRoot ? (
                <div className="ewr-muted">Select Save Folder</div>
              ) : (
                <>
                  <button
                    type="button"
                    className="ewr-button"
                    style={{ background: "linear-gradient(180deg, rgba(96,76,180,0.98) 0%, rgba(59,40,127,0.98) 100%)", borderColor: "rgba(171,151,255,0.6)" }}
                    onClick={() => void handleCreateNewSession()}
                    disabled={!saveRoot || !universe}
                  >
                    <IconPlus className="btnSvg" />
                    Create New Session
                  </button>
                  <div style={{ display: "grid", gap: 8, overflowX: "hidden" }}>
                    {recentSessions.filter((session) => session.root === saveRoot).length === 0 ? (
                      <div className="ewr-muted">No saved Cranky Vince sessions for this save folder yet.</div>
                    ) : recentSessions.filter((session) => session.root === saveRoot).map((session) => {
                      const fallbackInitials = (() => {
                        const match = String(session.promotionLabel || "").match(/\(([^)]+)\)\s*$/);
                        return String(match?.[1] || "").trim();
                      })();
                      const sessionTitle = String(session.promotionInitials || fallbackInitials || "").trim() || session.label;
                      return (
                      <div
                        key={session.root}
                        style={{
                          borderRadius: 18,
                          border: saveRoot === session.root && state ? "1px solid rgba(69,113,255,0.82)" : "1px solid rgba(255,255,255,0.12)",
                          background: "linear-gradient(180deg, rgba(18,28,70,0.92), rgba(9,14,32,0.94))",
                          boxShadow: saveRoot === session.root && state ? "0 0 0 1px rgba(69,113,255,0.18) inset" : "0 8px 22px rgba(0,0,0,0.18)",
                          padding: 12,
                          display: "grid",
                          gridTemplateColumns: "minmax(0,1fr) auto",
                          gap: 10,
                          alignItems: "center",
                          overflow: "hidden",
                          minWidth: 0,
                        }}
                      >
                        <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                            <div className="ewr-pill" style={{ padding: "5px 9px", fontSize: 11, flexShrink: 0 }}>Wk {session.week}</div>
                            <div style={{ fontSize: 15, fontWeight: 900, color: "rgba(255,255,255,0.98)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={sessionTitle}>
                              {sessionTitle}
                            </div>
                          </div>
                          <div className="ewr-muted" style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.promotionLabel || session.label}>
                            {session.promotionLabel || session.label}
                          </div>
                          <div className="ewr-muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.root}>
                            {session.root}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          <button
                            type="button"
                            title="Load Session"
                            aria-label={`Load ${session.label}`}
                            onClick={() => void openSaveSession(session.root)}
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 18,
                              border: "2px solid rgba(102,185,255,0.78)",
                              background: "linear-gradient(180deg, rgba(61,98,128,0.34), rgba(19,32,47,0.72))",
                              color: "rgba(255,255,255,0.96)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                              cursor: "pointer",
                            }}
                          >
                            <IconFolderOpen className="btnSvg" />
                          </button>
                          <button
                            type="button"
                            title="Delete Session"
                            aria-label={`Delete ${session.label}`}
                            onClick={() => void handleDeleteSessionCard(session.root)}
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 18,
                              border: "2px solid rgba(255,86,86,0.72)",
                              background: "linear-gradient(180deg, rgba(100,22,32,0.34), rgba(47,14,19,0.78))",
                              color: "rgba(255,255,255,0.96)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                              cursor: "pointer",
                            }}
                          >
                            <IconTrash className="btnSvg" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="ewr-sectionTitle" style={{ margin: 0 }}>Recent Reveals</div>
            <div style={{ display: "grid", gap: 4 }}>
              {(state?.history ?? []).length === 0 ? <div className="ewr-muted">No rules revealed yet.</div> : (state?.history ?? []).map((item, idx) => (
                <div key={`${item.week}-${item.slotId}-${idx}`}>
                  <LeftPanelNameCard
                    name={`${idx + 1}. Week ${item.week}: ${item.title}`}
                    isSelected={idx === selectedHistoryIndex}
                    onSelect={() => setSelectedHistoryIndex(idx)}
                    showActions={false}
                    leading={
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div className="ewr-pill" style={{ minWidth: 28, justifyContent: "center", padding: "5px 8px", fontSize: 11 }}>{idx + 1}</div>
                        <div className="ewr-pill" style={{ padding: "5px 9px", fontSize: 11 }}>{item.kind === "filler" ? "Chaos" : "Rule"}</div>
                      </div>
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: 14, borderTop: "1px solid rgba(255,255,255,0.08)", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="ewr-button" style={{ background: "linear-gradient(180deg, rgba(96,76,180,0.98) 0%, rgba(59,40,127,0.98) 100%)", borderColor: "rgba(171,151,255,0.6)" }} type="button" onClick={handleDrawFive} disabled={drawDisabled}><IconPlus className="btnSvg" />Draw Five</button>
            <button className="ewr-button" style={{ background: "linear-gradient(180deg, rgba(96,76,180,0.98) 0%, rgba(59,40,127,0.98) 100%)", borderColor: "rgba(171,151,255,0.6)" }} type="button" onClick={handleAdvanceWeek} disabled={!state || !state.chosenCard}><span className="btnSvg" aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900 }}>➜</span>Advance Week</button>
            <button className="ewr-button" style={{ background: "linear-gradient(180deg, rgba(96,76,180,0.98) 0%, rgba(59,40,127,0.98) 100%)", borderColor: "rgba(171,151,255,0.6)" }} type="button" onClick={() => { if (!state?.selectedPromotionId) return; if (typeof window !== "undefined" && !window.confirm("Rebuild Current Deck will start a brand new 52-card deck using the current built-in and custom rule pool. Your current locked deck will be replaced. Proceed?")) return; void rebuildDeckForPromotion(state.selectedPromotionId); }} disabled={!state || !universe}><IconGrid className="btnSvg" />Rebuild Current Deck</button>
            <button className="ewr-button ewr-buttonGreen" type="button" onClick={() => state && persistState(state)} disabled={!state || !saveRoot}><IconSave className="btnSvg" />Save State</button>
          </div>
        </div>
      </div>
      <RightPanelShell header={header}>
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>{optionsOpen ? "Cranky Vince Options" : currentRuleTitle}</div>
              <div className="ewr-muted" style={{ marginTop: 6, fontSize: 13 }}>
                {selectedPromo ? `${selectedPromo.name} (${selectedPromo.initials})` : "Select a save folder to unleash Cranky Vince."}{optionsOpen ? "" : currentDisplay ? ` — Week ${selectedRuleWeek}` : state ? ` — Week ${state.week}` : ""}
              </div>
            </div>
            <button className="ewr-button" type="button" style={{ minHeight: 40, padding: "0 14px" }} onClick={() => setOptionsOpen((v) => !v)}>
              {optionsOpen ? "Back to Cranky Vince" : "Cranky Vince Options"}
            </button>
          </div>

          {optionsOpen ? (
            <div className="ewr-groupCard" style={{ padding: 16, display: "grid", gap: 14 }}>
              <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                Browse the full built-in ruleset, manage custom rule packs, and use optional era/date windows.
              </div>
              <div className="ewr-muted" style={{ fontSize: 12 }}>
                Built-in rules: {builtInSeriousTitles.length} serious • {builtInFillerTitles.length} filler/gimmick. Custom rules: {CUSTOM_RULE_PACK.serious.length} serious • {CUSTOM_RULE_PACK.filler.length} filler.
              </div>

              <div className="ewr-groupCard" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="ewr-sectionTitle" style={{ margin: 0 }}>Built-In Rules</div>
                <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Browse the built-in Cranky Vince rules, preview their starter templates, and copy one into the editor as the base for a new custom rule.
                </div>
              </div>

              <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                <div className="ewr-label" style={{ fontSize: 18, fontWeight: 900 }}>Built-In Rule Viewer</div>
                <div className="ewr-muted" style={{ fontSize: 12 }}>
                  Click a built-in rule below to preview how its starter template is written. Use Copy to send that starter template into the Custom Rule Creator. All current built-in rules are date-unrestricted unless you deliberately add limits later.
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="ewr-pill" style={{ padding: "4px 9px", fontSize: 11 }}>{selectedBuiltInRule ? (selectedBuiltInRule.kind === "filler" ? "Filler / Gimmick" : "Serious") : "Viewer"}</div>
                    <div className="ewr-label" style={{ margin: 0 }}>{selectedBuiltInRule?.title ?? "No built-in rule selected"}</div>
                  </div>
                  <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>Era: {describeRuleEra(selectedBuiltInRule)}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.55 }}>{buildInRuleViewerText(selectedBuiltInRule)}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="ewr-groupCard" style={{ padding: 12, minHeight: 220 }}>
                  <div className="ewr-label" style={{ marginBottom: 8, fontSize: 18, fontWeight: 900 }}>Built-In Serious Rules</div>
                  <div style={{ display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>
                    {builtInSeriousRules.map((rule) => (
                      <div key={rule.key} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => setSelectedBuiltInRule(rule)}
                          style={{
                            minHeight: 0,
                            padding: "8px 10px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            background: selectedBuiltInRule?.key === rule.key ? "rgba(60,100,255,0.22)" : undefined,
                            borderColor: selectedBuiltInRule?.key === rule.key ? "rgba(90,140,255,0.55)" : undefined,
                          }}
                        >
                          <span className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.35 }}>{rule.title}</span>
                        </button>
                        <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => handleUseBuiltInRuleTemplate(rule)}>Copy</button>
                        <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => void handleToggleHiddenRule({ key: String(rule.key), title: String(rule.title), kind: rule.kind ?? "serious" })}>{HIDDEN_RULE_KEYS.has(rule.key) ? "Unhide" : "Hide"}</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, minHeight: 220 }}>
                  <div className="ewr-label" style={{ marginBottom: 8, fontSize: 18, fontWeight: 900 }}>Built-In Filler / Gimmick Rules</div>
                  <div style={{ display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>
                    {builtInFillerRules.map((rule) => (
                      <div key={rule.key} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          className="ewr-button"
                          onClick={() => setSelectedBuiltInRule(rule)}
                          style={{
                            minHeight: 0,
                            padding: "8px 10px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            background: selectedBuiltInRule?.key === rule.key ? "rgba(60,100,255,0.22)" : undefined,
                            borderColor: selectedBuiltInRule?.key === rule.key ? "rgba(90,140,255,0.55)" : undefined,
                          }}
                        >
                          <span className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.35 }}>{rule.title}</span>
                        </button>
                        <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => handleUseBuiltInRuleTemplate(rule)}>Copy</button>
                        <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => void handleToggleHiddenRule({ key: String(rule.key), title: String(rule.title), kind: rule.kind ?? "serious" })}>{HIDDEN_RULE_KEYS.has(rule.key) ? "Unhide" : "Hide"}</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ewr-groupCard" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="ewr-sectionTitle" style={{ margin: 0 }}>Custom Rules</div>
                <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Create, organize, preview, edit, hide, import, and export your reusable global Cranky Vince custom rule library.
                </div>
              </div>

              <div className="ewr-label" style={{ fontSize: 18, fontWeight: 900 }}>Custom Rule Creator</div>
              <div className="ewr-muted" style={{ fontSize: 12 }}>
                Build, import, export, and share custom Cranky Vince rule packs directly through the editor. This works one rule at a time: pick a built-in rule as a starter, create a new one from scratch, or click an existing custom rule below to edit it. Use the placeholder buttons in the Rule Text editor to insert tokens without typing them by hand. Feud-style rules should usually use male/male or female/female placeholders, while romance-style rules can deliberately use male/female placeholders. Era-limited rules compare against the save's Current Date from gameinfo.dat
              </div>
              <div className="ewr-groupCard" style={{ padding: 12 }}>
                <details>
                  <summary className="ewr-label" style={{ fontSize: 16, fontWeight: 900, cursor: "pointer" }}>Placeholder Definitions</summary>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) 1fr", gap: 8, marginTop: 10 }}>
                    {placeholderDescriptions().map(([ph, desc]) => (
                      <>
                        <div className="ewr-mono" style={{ fontSize: 12 }}>{ph}</div>
                        <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{desc}</div>
                      </>
                    ))}
                  </div>
                </details>
              </div>
              <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                <div className="ewr-label" style={{ fontSize: 18, fontWeight: 900 }}>Custom Rule Viewer</div>
                <div className="ewr-muted" style={{ fontSize: 12 }}>
                  Preview a saved custom rule here before editing it or copying it into a new version.
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="ewr-pill" style={{ padding: "4px 9px", fontSize: 11 }}>{selectedViewedCustomRule ? (selectedViewedCustomRule.kind === "filler" ? "Filler / Gimmick" : "Serious") : "Viewer"}</div>
                    <div className="ewr-label" style={{ margin: 0 }}>{selectedViewedCustomRule?.title ?? "No custom rule selected"}</div>
                  </div>
                  <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>Era: {describeRuleEra(selectedViewedCustomRule)}</div>
                  <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>Collection: {selectedViewedCustomRule ? collectionNameOf(selectedViewedCustomRule) : "—"}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{selectedViewedCustomRule?.text ?? "Select a saved custom rule below to preview it here."}</div>
                </div>
              </div>

              <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="ewr-label" style={{ fontSize: 16, fontWeight: 900 }}>Current Custom Rules</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="ewr-muted" style={{ fontSize: 12 }}>Filter</div>
                    <select className="ewr-input" style={{ minWidth: 180 }} value={selectedCollectionFilter} onChange={(e) => setSelectedCollectionFilter(e.target.value)}>
                      <option value="all">All Collections</option>
                      {collectionOptions().map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Saved custom rules are grouped by collection below. Use View to preview one, Edit to load it into the editor, Copy to start a variant, Hide to remove it from deck generation, or Delete to remove it from the global pack.
                </div>
                <div style={{ display: "grid", gap: 12, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                  {groupedCustomRulesForList().length === 0 ? (
                    <div className="ewr-muted" style={{ fontSize: 12 }}>No custom rules yet. Start with a built-in template or create a new rule below.</div>
                  ) : groupedCustomRulesForList().map(([groupName, rules]) => (
                    <div key={groupName} className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div className="ewr-pill" style={{ padding: "5px 9px", fontSize: 11 }}>{groupName}</div>
                          <div className="ewr-muted" style={{ fontSize: 12 }}>{rules.length} rule{rules.length === 1 ? "" : "s"}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {editingCollectionName === groupName ? (
                            <>
                              <input className="ewr-input" style={{ minWidth: 180 }} defaultValue={groupName === "Ungrouped" ? "" : groupName} onChange={(e) => setEditingCollectionName(e.target.value)} />
                              <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => void handleRenameCollection(groupName, editingCollectionName)}>Save Name</button>
                              <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => setEditingCollectionName("")}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => setEditingCollectionName(groupName)}>Edit Group</button>
                              <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => void handleExportCollection(groupName)}>Export Collection</button>
                              <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => void handleToggleHiddenCollection(groupName)}>{HIDDEN_COLLECTIONS.has(groupName) ? "Enable Collection" : "Disable Collection"}</button>
                              <button className="ewr-button ewr-buttonRed" type="button" style={{ minHeight: 0, padding: "6px 10px" }} onClick={() => void handleDeleteCollection(groupName)}>Delete Group</button>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {rules.map((rule) => (
                          <div key={rule.key} className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ display: "grid", gap: 8 }}>
                                <div className="ewr-label" style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{rule.title}</div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <div className="ewr-pill" style={{ minWidth: 0, padding: "5px 9px", fontSize: 11 }}>{rule.kind === "filler" ? "Filler / Gimmick" : "Serious"}</div>
                                  <div className="ewr-pill" style={{ minWidth: 0, padding: "5px 9px", fontSize: 11 }}>{describeRuleEra(rule)}</div>
                                  {HIDDEN_RULE_KEYS.has(rule.key) ? <div className="ewr-pill" style={{ minWidth: 0, padding: "5px 9px", fontSize: 11, background: "rgba(170,120,40,0.24)", borderColor: "rgba(255,190,90,0.4)" }}>Hidden</div> : null}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => handleViewCustomRule(rule)}>View</button>
                                <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => handleEditCustomRule(rule)}>Edit</button>
                                <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => handleEditCustomRule({ ...rule, key: `${rule.key}_copy`, title: `${rule.title} Copy` })}>Copy</button>
                                <button className="ewr-button" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => void handleToggleHiddenRule({ key: String(rule.key), title: String(rule.title), kind: rule.kind ?? "serious" })}>{HIDDEN_RULE_KEYS.has(rule.key) ? "Unhide" : "Hide"}</button>
                                <button className="ewr-button ewr-buttonRed" type="button" style={{ minHeight: 0, padding: "8px 10px" }} onClick={() => void handleDeleteCustomRule(rule.key)}>Delete</button>
                              </div>
                            </div>
                            <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                              {rule.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <button className="ewr-button" type="button" onClick={() => handleNewCustomRule("serious")}>New Serious Rule</button>
                <button className="ewr-button" type="button" onClick={() => handleNewCustomRule("filler")}>New Filler Rule</button>
                <button className="ewr-button" type="button" onClick={() => { setEditorViewMode("standard"); setSelectedBuiltInRule(null); setSelectedCustomRuleKey(null); setCustomRulesText(selectedCustomRuleTemplate(null)); setCustomRulesError(""); }}>Blank Template</button>
              </div>

              <div className="ewr-label" style={{ fontSize: 16, fontWeight: 900 }}>
                {selectedCustomRuleKey ? "Edit Custom Rule" : selectedBuiltInRule ? "Built-In Rule Starter Template" : "Rule Editor"}
              </div>
              <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="ewr-field">
                    <div className="ewr-label">Rule Key</div>
                    <input className="ewr-input" value={currentEditorRule().key} onChange={(e) => updateEditorRuleField("key", e.target.value)} />
                  </div>
                  <div className="ewr-field">
                    <div className="ewr-label">Rule Type</div>
                    <select className="ewr-input" value={currentEditorRule().kind || "serious"} onChange={(e) => updateEditorRuleField("kind", e.target.value === "filler" ? "filler" : "serious")}>
                      <option value="serious">Serious</option>
                      <option value="filler">Filler / Gimmick</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="ewr-field">
                    <div className="ewr-label">Title</div>
                    <input className="ewr-input" value={currentEditorRule().title} onChange={(e) => updateEditorRuleField("title", e.target.value)} />
                  </div>
                  <div className="ewr-field">
                    <div className="ewr-label">Collection</div>
                    <input className="ewr-input" placeholder="Ungrouped" value={currentEditorRule().collection || ""} onChange={(e) => updateEditorRuleField("collection", e.target.value)} />
                  </div>
                </div>
                <div className="ewr-groupCard" style={{ padding: 12, display: "grid", gap: 10 }}>
                  <div className="ewr-sectionTitle" style={{ margin: 0 }}>Era / Date Limits</div>
                  <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Leave both blank if the rule can appear at any time. Use YYYY-MM-DD only.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="ewr-field">
                      <div className="ewr-label">Not Before</div>
                      <input className="ewr-input" placeholder="YYYY-MM-DD" value={currentEditorRule().notBefore || ""} onChange={(e) => updateEditorRuleField("notBefore", e.target.value)} />
                    </div>
                    <div className="ewr-field">
                      <div className="ewr-label">Not After</div>
                      <input className="ewr-input" placeholder="YYYY-MM-DD" value={currentEditorRule().notAfter || ""} onChange={(e) => updateEditorRuleField("notAfter", e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="ewr-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div className="ewr-label" style={{ margin: 0 }}>Rule Text</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="ewr-button"
                        style={{
                          minHeight: 0,
                          padding: "6px 10px",
                          background: editorViewMode === "standard" ? "#6ea8ff" : undefined,
                          borderColor: editorViewMode === "standard" ? "#9fc2ff" : undefined,
                        }}
                        onClick={() => setEditorViewMode("standard")}
                      >
                        Standard View
                      </button>
                      <button
                        type="button"
                        className="ewr-button"
                        style={{
                          minHeight: 0,
                          padding: "6px 10px",
                          background: editorViewMode === "code" ? "#6ea8ff" : undefined,
                          borderColor: editorViewMode === "code" ? "#9fc2ff" : undefined,
                        }}
                        onClick={() => setEditorViewMode("code")}
                      >
                        Code View
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {[
                      ["Promotion", "{promotion}"],
                      ["Initials", "{initials}"],
                      ["Worker 1", "{worker1}"],
                      ["Worker 2", "{worker2}"],
                      ["Worker 3", "{worker3}"],
                      ["Male Worker", "{maleWorker}"],
                      ["Female Worker", "{femaleWorker}"],
                      ["Male 1", "{maleWorker1}"],
                      ["Male 2", "{maleWorker2}"],
                      ["Male 3", "{maleWorker3}"],
                      ["Female 1", "{femaleWorker1}"],
                      ["Female 2", "{femaleWorker2}"],
                      ["Female 3", "{femaleWorker3}"],
                      ["Top Worker", "{topWorker}"],
                      ["Least Over", "{leastOverWorker}"],
                      ["Oldest Worker", "{oldestWorker}"],
                      ["World Title", "{worldTitle}"],
                      ["Midcard Title", "{midcardTitle}"],
                      ["Tag Title", "{tagTitle}"],
                      ["Women's Title", "{womensTitle}"],
                      ["Other Promotion", "{otherPromotion}"],
                    ].map(([label, token]) => (
                      <button
                        key={token}
                        type="button"
                        className="ewr-button"
                        style={{ minHeight: 0, padding: "6px 10px" }}
                        onClick={() => insertPlaceholderAtCursor(String(token))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {editorViewMode === "standard" ? (
                    <textarea
                      ref={ruleTextRef}
                      className="ewr-input"
                      style={{ minHeight: 160, resize: "vertical", lineHeight: 1.45 }}
                      value={currentEditorRule().text}
                      onChange={(e) => updateEditorRuleField("text", e.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <textarea
                      className="ewr-input"
                      style={{ minHeight: 240, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.4 }}
                      value={customRulesText}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setCustomRulesText(nextValue);
                        const parsed = parseEditorRuleInput(nextValue);
                        if (parsed) setCustomRulesError("");
                      }}
                      spellCheck={false}
                    />
                  )}
                </div>
              </div>
              {customRulesError ? <div className="ewr-errorText">{customRulesError}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                <button className="ewr-button ewr-buttonGreen" type="button" onClick={() => void handleSaveCustomRules()} >Save Rule To Pack</button>
                <button className="ewr-button" type="button" onClick={() => { setEditorViewMode("standard"); setSelectedCustomRuleKey(null); setSelectedBuiltInRule(null); setCustomRulesText(selectedCustomRuleTemplate(null)); setCustomRulesError(""); }}>Reset Editor</button>
              </div>
              <div className="ewr-groupCard" style={{ padding: 14, display: "grid", gap: 12, marginTop: 14 }}>
                <div className="ewr-sectionTitle" style={{ margin: 0 }}>AI Tools</div>
                <div className="ewr-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Use the starter prompt below to generate new placeholder-based Cranky Vince rules in the correct format for this editor.
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                <div className="ewr-label" style={{ fontSize: 16, fontWeight: 900 }}>AI Rule Generator Starter Prompt</div>
                <div className="ewr-groupCard" style={{ padding: 12 }}>
                  <details>
                    <summary className="ewr-label" style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span>Ready-made prompt for ChatGPT, Google Gemini, or any AI agent</span>
                    </summary>
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <div className="ewr-muted" style={{ fontSize: 12 }}>
                        Use this prompt in the AI tool of your choice to generate new placeholder-based Cranky Vince custom rules.
                      </div>
                      <textarea
                        className="ewr-input"
                        style={{ minHeight: 320, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.45 }}
                        value={AI_RULE_GENERATOR_STARTER_PROMPT}
                        readOnly
                        spellCheck={false}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="ewr-button" type="button" onClick={() => void handleCopyAiStarterPrompt()}>
                          Copy Prompt
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 18 }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {showAnyCards ? visibleCards.map((card, idx) => {
                    const isChosen = state?.chosenCard?.slotId === card.slotId;
                    const face = CARD_FACE_MAP[card.slotId] || CARD_BACK;
                    const canReveal = !!state?.offeredCards.length && !state?.chosenCard;
                    return (
                      <button key={`${card.slotId}-${idx}`} type="button" onClick={() => canReveal ? handleRevealCard(card.slotId) : undefined} disabled={!canReveal} style={{ width: 140, height: 196, borderRadius: 12, border: isChosen ? "2px solid rgba(255,180,60,0.85)" : "1px solid rgba(255,255,255,0.12)", background: "rgba(18,22,32,0.9)", boxShadow: isChosen ? "0 0 0 2px rgba(255,180,60,0.16), 0 10px 26px rgba(0,0,0,0.28)" : "0 8px 24px rgba(0,0,0,0.22)", overflow: "hidden", padding: 0, cursor: canReveal ? "pointer" : "default" }} title={canReveal ? "Reveal this card" : card.slotId}>
                        <img src={(canReveal || !isChosen) ? CARD_BACK : face} alt={canReveal ? "card back" : card.slotId.replace(/_/g, " ")} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </button>
                    );
                  }) : null}
                  {deckBackVisible ? (
                    <button type="button" onClick={handleDrawFive} disabled={drawDisabled} style={{ width: 140, height: 196, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(18,22,32,0.9)", boxShadow: "0 8px 24px rgba(0,0,0,0.22)", overflow: "hidden", padding: 0, cursor: drawDisabled ? "default" : "pointer" }} title="Draw five cards from the deck">
                      <img src={CARD_BACK} alt="deck" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  ) : null}
                </div>
                <div className="ewr-groupCard" style={{ padding: 16, display: "grid", gap: 16 }}>
                  {currentDisplay ? (
                    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 18, alignItems: "start" }}>
                      <div style={{ width: 180, height: 252, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 10px 28px rgba(0,0,0,0.24)", background: "rgba(18,22,32,0.9)" }}>
                        <img src={currentCardFace || CARD_BACK} alt={currentDisplay.slotId ? currentDisplay.slotId.replace(/_/g, " ") : "card"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </div>
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div className="ewr-sectionTitle" style={{ margin: 0 }}>Resolved Challenge Card</div>
                          {currentRuleKind ? <div className="ewr-pill" style={{ padding: "4px 9px", fontSize: 11 }}>{currentRuleKind === "filler" ? "Chaos" : "Rule"}</div> : null}
                        </div>
                        <div style={{ fontSize: 18, lineHeight: 1.5 }}>{currentRuleText}</div>
                        <div className="ewr-muted" style={{ fontSize: 12 }}>
                          Serious cards are only included when the current save can support them. Any empty space in the locked 52-card deck is filled with generic chaos cards so every run still feels like a full board-game deck.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 10px" }}>
                        <img src={crankyVinceLogo} alt="Cranky Vince" style={{ maxWidth: 420, width: "100%", height: "auto", display: "block" }} />
                      </div>
                      <div className="ewr-sectionTitle" style={{ margin: 0 }}>What Is Cranky Vince?</div>
                      <div style={{ fontSize: 17, lineHeight: 1.6 }}>
                        Cranky Vince is a save-aware deck of booking disasters based on the EWB Diary Dome challenge created by board member brenchill. It studies your real promotion, roster, champions, and current situation, then hits you with one absurd new mandate every week, like you’re booking under a delusional tyrant who changes the entire card five minutes before bell time because he’s suddenly convinced &quot;That&apos;s Good shit, pal!&quot;
                      </div>
                      <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                        Here is the deal. You get a 52-card deck of booking disasters. Once a week, or before each show if you want to live dangerously, you draw five cards and pick one. That card becomes your marching orders for the week. The other four go back into the deck to ruin your life later. You keep doing that for ten weeks, then the deck gets reshuffled into a fresh set of rules because Vince is not interested in letting you become comfortable.
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="ewr-groupCard" style={{ padding: 16, display: "grid", gap: 8 }}>
                <div className="ewr-sectionTitle" style={{ margin: 0 }}>Engine Rules</div>
                <div className="ewr-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Cranky Vince builds a promotion-specific 52-card deck from a larger rule library. Real rules only make the cut when your save can actually support them. If there are gaps, filler chaos cards are added so the deck still feels complete. Draw five, pick one, obey it, discard it, shuffle the rest back, then repeat until week ten resets the misery. Advanced users can also add their own rule pack with a cranky_vince_rules.json file inside the save folder.
                </div>
              </div>
            </>
          )}
        </div>
      </RightPanelShell>
    </div>
  );
}

