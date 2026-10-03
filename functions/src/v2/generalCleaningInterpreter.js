"use strict";

const { rawInputIdentity, advisoryResult } = require("./generalCleaningInterpretationDomain");

const AREAS = Object.freeze({ bedroom: "bedroom", bedrooms: "bedroom",
  bathroom: "bathroom", bathrooms: "bathroom", kitchen: "kitchen", kitchens: "kitchen" });
const NUMBERS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });

function tokenize(text) {
  // Preserve original UTF-16 offsets, including around Unicode/unknown tokens.
  return [...text.matchAll(/[A-Za-z]+|[0-9]+|[^\s]/gu)].map((m) =>
    ({ value: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length }));
}
// Derived tokens retain original UTF-16 evidence offsets. No input text is rewritten.
// Typo repair is limited to one vowel edit in two grammar slots, not arbitrary words.
function vowelVariant(word, expected) {
  if (word.length < 5 || word.replace(/[aeiou]/g, "") !== expected.replace(/[aeiou]/g, "")) return false;
  if (word.length === expected.length) return [...word].filter((c, i) => c !== expected[i]).length === 1;
  const [longer, shorter] = word.length > expected.length ? [word, expected] : [expected, word];
  return longer.length === shorter.length + 1 && [...longer].some((c, i) =>
    /[aeiou]/.test(c) && longer.slice(0, i) + longer.slice(i + 1) === shorter);
}
function humanTokens(tokens) {
  let result = tokens.map(t => ({ ...t }));
  if (result[0]?.value === "i" && ["'", "’"].includes(result[1]?.value) && ["d", "m"].includes(result[2]?.value)) {
    result.splice(1, 2, { value: result[2].value === "d" ? "would" : "am", start: result[1].start, end: result[2].end });
  }
  if (result[0]?.value === "please") result.shift();
  while ([".", "!", "?"].includes(result.at(-1)?.value)) result.pop();
  if (result.at(-1)?.value === "please") {
    result.pop(); if (result.at(-1)?.value === ",") result.pop();
  }
  // Only framing "someone to" and action "clean/cleaning" can be repaired.
  // Consonants, negation, exclusions, area names, quantities and hazards are untouched.
  for (let i = 0; i < result.length; i++) {
    const value = result[i].value;
    if (result[i + 1]?.value === "to" && vowelVariant(value, "someone")) result[i].value = "someone";
    else {
      const matches = ["clean", "cleaning"].filter(word => vowelVariant(value, word));
      if (matches.length === 1) result[i].value = matches[0];
    }
  }
  return result;
}
function evidence(field, tokens, rule) {
  return { field, start: tokens[0].start, end: tokens[tokens.length - 1].end, rule };
}
function quantity(word) {
  if (Object.hasOwn(NUMBERS, word)) return NUMBERS[word];
  return /^[1-9][0-9]{0,3}$/.test(word) ? Number(word) : null;
}

function target(tokens, field, boundedRoom = false) {
  let words = tokens.map((t) => t.value);
  if (["my apartment", "an apartment", "the apartment", "apartment", "my whole apartment",
    "the whole apartment", "whole apartment"].includes(words.join(" "))) {
    return { proposals: [], context: [{ dwelling: "apartment", evidence: [evidence(field, tokens, "dwelling_context")] }],
      extentAssertions: words.includes("whole") ? [{ extent: "whole_apartment",
        evidence: [evidence(field, tokens, "whole_dwelling_extent")] }] : [] };
  }
  if (boundedRoom && ["my room", "the room", "a room", "room"].includes(words.join(" "))) {
    return { proposals: [{ slot: "approximate_scale",
      value: { kind: "rooms", quantity: 1, wire_value: "1 room" },
      evidence: [evidence(field, tokens, "generic_room_quantity")] }],
      context: [], extentAssertions: [], genericRoom: true };
  }
  const groups = []; let start = 0;
  for (let i = 0; i <= tokens.length; i++) {
    if (i === tokens.length || tokens[i].value === "and") { groups.push(tokens.slice(start, i)); start = i + 1; }
  }
  const areas = []; let total = 0; let knownQuantity = true;
  for (const group of groups) {
    words = group.map((t) => t.value);
    if (words.length < 1 || words.length > 3) return null;
    const noun = words[words.length - 1];
    if (!Object.hasOwn(AREAS, noun)) return null;
    let prefix = words.slice(0, -1);
    if (prefix[0] === "my" || prefix[0] === "the") prefix = prefix.slice(1);
    if (prefix.length > 1) return null;
    let count = null;
    if (!prefix.length) count = noun.endsWith("s") ? null : 1;
    else if (prefix[0] === "a") count = 1;
    else count = quantity(prefix[0]);
    if (prefix.length && count === null || count !== null && (count === 1) === noun.endsWith("s")) return null;
    if (areas.includes(AREAS[noun])) return null; // repeated mentions are not silently summed
    areas.push(AREAS[noun]);
    if (count === null) knownQuantity = false;
    else total += count;
  }
  if (!areas.length) return null;
  const proposals = [{ slot: "areas_items", value: areas.sort(), evidence: [evidence(field, tokens, "explicit_room_areas")] }];
  if (knownQuantity && total <= 9999) proposals.push({ slot: "approximate_scale",
    value: { kind: "rooms", quantity: total, wire_value: `${total} ${total === 1 ? "room" : "rooms"}` },
    evidence: [evidence(field, tokens, "explicit_room_quantity")] });
  return { proposals, context: [], extentAssertions: [] };
}

function parse(text, field, boundedRoom = false, human = false) {
  const all = human ? humanTokens(tokenize(text)) : tokenize(text);
  if (!all.length) return human && tokenize(text).length ? null : { proposals: [], context: [], extentAssertions: [] };
  const tokens = [...all];
  if ([".", "!", "?"].includes(tokens[tokens.length - 1].value)) tokens.pop();
  const sentence = tokens.map((t) => t.value).join(" ");
  if (["general cleaning", "general apartment cleaning", "apartment cleaning"].includes(sentence)) {
    return { proposals: [], extentAssertions: [], context: sentence.includes("apartment") ?
      [{ dwelling: "apartment", evidence: [evidence(field, tokens, "dwelling_context")] }] : [] };
  }
  if (human && /^my (place|apartment|home) needs (a )?(good )?cleaning$/.test(sentence)) {
    return { proposals: [], context: [{ dwelling: "unspecified_dwelling", evidence: [evidence(field, tokens, "dwelling_cleaning_intent")] }], extentAssertions: [] };
  }
  // Bounded framing is consumed as a prefix, never searched inside unknown prose.
  let index = 0;
  const prefixes = ["i just need someone to", "i need someone to", "need someone to",
    "looking for someone to", "i just need some", "i need some", "i just need", "i need"];
  if (boundedRoom) prefixes.unshift("just need someone to");
  if (human) prefixes.unshift("i am looking for someone to", "i would like someone to", "i would like", "can someone", "could someone", "need help", "i need help");
  for (const prefix of prefixes) {
    const words = prefix.split(" ");
    if (words.every((word, i) => tokens[i]?.value === word)) { index = words.length; break; }
  }
  const actionStart = index;
  let level = null;
  if (["deep", "standard"].includes(tokens[index]?.value)) level = tokens[index++].value.toUpperCase();
  if (!["clean", "cleaning"].includes(tokens[index]?.value)) return null;
  index++;
  const actionEnd = index;
  if (["for", "of"].includes(tokens[index]?.value)) index++;
  if (index >= tokens.length) return null;
  const remaining = tokens.slice(index);
  const contextual = human && remaining.map(t => t.value).join(" ") === "after a party";
  const parsed = contextual ? { proposals: [], context: [], extentAssertions: [] } : target(remaining, field, boundedRoom);
  if (!parsed) return null;
  if (level) parsed.proposals.push({ slot: "cleaning_level", value: level,
    evidence: [evidence(field, tokens.slice(actionStart, actionEnd), "explicit_cleaning_level")] });
  return parsed;
}

/** Pure server-side advisory interpreter. No storage, callable, policy or provider dependency.
 * Unknown clauses invalidate that field's parse rather than being dropped or
 * mislabeled harmless. Other fully parsed fields can still supply proposals.
 */
function interpretGeneralCleaning(input) {
  rawInputIdentity(input);
  const output = { proposals: [], unhandled: [], extentAssertions: [], context: [] };
  for (const field of ["title", "description"]) {
    const direct = parse(input[field], field, true, true);
    const extended = direct ? null : reconciliationEvidence(input[field], field, true, true);
    const parsed = direct || (extended?.genericRoom ? extended : null);
    if (!parsed) {
      output.unhandled.push({ field, start: 0, end: input[field].length, reason: "unclassified_content" });
    } else {
      output.proposals.push(...parsed.proposals);
      output.extentAssertions.push(...parsed.extentAssertions);
      output.context.push(...parsed.context);
    }
  }
  return advisoryResult(input, output);
}

// Historical text-6 uses the original parser; text-7 enables bounded room ambiguity.
// Only text-8/current advisory enable human-expression normalization. Complete
// fields must still parse; unknown clauses are never deleted.
function reconciliationEvidence(text, field, boundedRoom = false, human = false) {
  const tokens = tokenize(text);
  const withQuantity = (parsed) => parsed && { ...parsed,
    explicitNumericQuantity: tokens.some((token) => quantity(token.value) !== null) };
  const existing = parse(text, field, boundedRoom, human);
  if (existing) return withQuantity(existing);
  if ([".", "!", "?"].includes(tokens.at(-1)?.value)) tokens.pop();
  if (tokens.at(-1)?.value === "only") {
    const parsed = parse(text.slice(0, tokens.at(-1).start), field, boundedRoom, human);
    const areas = parsed?.proposals.find((p) => p.slot === "areas_items");
    if (parsed?.genericRoom) return { ...withQuantity(parsed), exclusiveRoom: true };
    if (areas && !parsed.extentAssertions.length) return { ...withQuantity(parsed), exclusiveAreas: areas.value };
  }
  if (tokens.at(-1)?.value === "cleaning") return withQuantity(target(tokens.slice(0, -1), field, boundedRoom));
  return null;
}
module.exports = { interpretGeneralCleaning, reconciliationEvidence };
