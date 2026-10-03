"use strict";
// Comparison only, after qualified Geosupport 1B evidence. Not a geocoder.
// NYC UPG III.2 documents ordinal deletion and contextual abbreviation expansion.
// Limit expansion to complete numbered-street forms; never rewrite name initials,
// AVENUE S, S STREET, ST MARKS PLACE, hyphens, or unknown punctuation.
const normalize = (s) => s.trim().replace(/\s+/g, " ").toUpperCase();
function numberedStreet(value) {
  const match = /^(?:(EAST|WEST|NORTH|SOUTH|E\.?|W\.?|N\.?|S\.?) )?([1-9][0-9]{0,2})(ST|ND|RD|TH)? (STREET|ST\.?|AVENUE|AVE\.?|ROAD|RD\.?|BOULEVARD|BLVD\.?)$/.exec(normalize(value));
  if (!match) return null;
  const n = Number(match[2]);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "TH" : ({1:"ST",2:"ND",3:"RD"}[n % 10] || "TH");
  if (match[3] && match[3] !== suffix) return null;
  const direction = (match[1] || "").replace(/\.$/, "");
  const type = match[4].replace(/\.$/, "");
  return [({E:"EAST",W:"WEST",N:"NORTH",S:"SOUTH"}[direction] || direction), match[2],
    ({ST:"STREET",AVE:"AVENUE",RD:"ROAD",BLVD:"BOULEVARD"}[type] || type)].join(" ");
}
function equivalentStreet(submitted, resolved) {
  if (normalize(submitted) === normalize(resolved)) return true;
  const left = numberedStreet(submitted);
  return left !== null && left === numberedStreet(resolved);
}
module.exports = { equivalentStreet };
