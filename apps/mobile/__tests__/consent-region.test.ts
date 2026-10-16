import {
  EEA_UK_CH_COUNTRIES,
  EU_COUNTRIES,
  GEO_MAX_AGE_MS,
  US_OPT_IN_STATES,
  consentModeFor,
  freshGeo,
} from "../lib/consent-region";

describe("consentModeFor", () => {
  it("asks first in every EU country", () => {
    expect(EU_COUNTRIES).toHaveLength(27);
    for (const country of EU_COUNTRIES) expect(consentModeFor({ country, region: null })).toBe("opt-in");
  });

  it("asks first in the rest of the EEA, the UK and Switzerland", () => {
    expect([...EEA_UK_CH_COUNTRIES].sort()).toEqual(["CH", "GB", "IS", "LI", "NO"]);
    for (const country of EEA_UK_CH_COUNTRIES) expect(consentModeFor({ country, region: null })).toBe("opt-in");
  });

  it("asks first in California, Washington and Oregon", () => {
    expect([...US_OPT_IN_STATES].sort()).toEqual(["CA", "OR", "WA"]);
    for (const region of US_OPT_IN_STATES) expect(consentModeFor({ country: "US", region })).toBe("opt-in");
  });

  it("lets the rest of the US default on", () => {
    for (const region of ["TX", "NY", "FL", "NV", "ID", "DC", "AK", "HI"]) {
      expect(consentModeFor({ country: "US", region })).toBe("opt-out");
    }
  });

  it("asks when the US state is missing, since it could be one of the three", () => {
    expect(consentModeFor({ country: "US", region: null })).toBe("opt-in");
    expect(consentModeFor({ country: "US", region: "" })).toBe("opt-in");
  });

  it("asks when the place is unknown", () => {
    expect(consentModeFor(null)).toBe("opt-in");
    expect(consentModeFor(undefined)).toBe("opt-in");
    expect(consentModeFor({ country: null, region: null })).toBe("opt-in");
    expect(consentModeFor({ country: null, region: "TX" })).toBe("opt-in");
  });

  it("asks in countries the owner did not name as opt-out, including US territories", () => {
    for (const country of ["BR", "CA", "CN", "IN", "AU", "JP", "KR", "PR", "MX"]) {
      expect(consentModeFor({ country, region: null })).toBe("opt-in");
    }
  });

  it("ignores case and padding in codes", () => {
    expect(consentModeFor({ country: " us ", region: " tx " })).toBe("opt-out");
    expect(consentModeFor({ country: "us", region: "ca" })).toBe("opt-in");
  });
});

describe("freshGeo", () => {
  const geo = { country: "US", region: "TX" };

  it("trusts a lookup until it is a week old", () => {
    expect(freshGeo({ geo, fetchedAt: 1000 }, 1000 + GEO_MAX_AGE_MS)).toBe(geo);
    expect(freshGeo({ geo, fetchedAt: 1000 }, 1000 + GEO_MAX_AGE_MS + 1)).toBeNull();
  });

  it("distrusts nothing stored, and a lookup stamped in the future", () => {
    expect(freshGeo(null, 5)).toBeNull();
    expect(freshGeo({ geo, fetchedAt: 10 }, 5)).toBeNull();
  });
});
