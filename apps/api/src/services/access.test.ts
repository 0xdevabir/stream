import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACCESS_MODES } from "@stream/shared";

import { type AccessFacts, decideAccess } from "./access";

/**
 * Access control is the part of this system where a bug is a data breach
 * rather than a glitch, so the rules are tested exhaustively against every
 * access mode.
 */

const NOBODY: AccessFacts = {
  isStreamInstructor: false,
  isOrgAdmin: false,
  isOrgMember: false,
  isEnrolled: false,
  shareTokenMatches: false,
  passwordProvided: false,
  passwordMatches: false,
};

const facts = (overrides: Partial<AccessFacts> = {}): AccessFacts => ({
  ...NOBODY,
  ...overrides,
});

describe("decideAccess", () => {
  it("lets the instructor into their own class in every mode", () => {
    for (const mode of ACCESS_MODES) {
      const decision = decideAccess(mode, facts({ isStreamInstructor: true }));
      assert.deepEqual(
        decision,
        { allowed: true, role: "instructor" },
        `instructor denied in ${mode} mode`,
      );
    }
  });

  it("lets org admins in without an enrollment row", () => {
    for (const mode of ACCESS_MODES) {
      const decision = decideAccess(mode, facts({ isOrgAdmin: true }));
      assert.deepEqual(
        decision,
        { allowed: true, role: "admin" },
        `admin denied in ${mode} mode`,
      );
    }
  });

  it("denies an anonymous stranger in every mode except PUBLIC", () => {
    for (const mode of ACCESS_MODES) {
      const decision = decideAccess(mode, NOBODY);
      if (mode === "PUBLIC") {
        assert.equal(decision.allowed, true, "PUBLIC should be open");
      } else {
        assert.equal(
          decision.allowed,
          false,
          `${mode} must not admit an anonymous stranger`,
        );
      }
    }
  });

  describe("PUBLIC", () => {
    it("admits anyone", () => {
      assert.deepEqual(decideAccess("PUBLIC", NOBODY), {
        allowed: true,
        role: "viewer",
      });
    });
  });

  describe("LINK", () => {
    it("admits a correct share token", () => {
      assert.deepEqual(
        decideAccess("LINK", facts({ shareTokenMatches: true })),
        { allowed: true, role: "viewer" },
      );
    });

    it("rejects a wrong or missing token", () => {
      assert.deepEqual(decideAccess("LINK", NOBODY), {
        allowed: false,
        reason: "invalid_link",
      });
    });

    it("does not accept org membership as a substitute for the link", () => {
      assert.equal(
        decideAccess("LINK", facts({ isOrgMember: true })).allowed,
        false,
      );
    });
  });

  describe("PASSWORD", () => {
    it("distinguishes 'no password given' from 'wrong password'", () => {
      assert.deepEqual(decideAccess("PASSWORD", NOBODY), {
        allowed: false,
        reason: "password_required",
      });
      assert.deepEqual(
        decideAccess("PASSWORD", facts({ passwordProvided: true })),
        { allowed: false, reason: "invalid_password" },
      );
    });

    it("admits a correct password", () => {
      assert.deepEqual(
        decideAccess(
          "PASSWORD",
          facts({ passwordProvided: true, passwordMatches: true }),
        ),
        { allowed: true, role: "viewer" },
      );
    });

    // Guards against a refactor that trusts `passwordMatches` on its own.
    it("never admits a match that was never provided", () => {
      assert.equal(
        decideAccess("PASSWORD", facts({ passwordMatches: true })).allowed,
        false,
      );
    });
  });

  describe("ORG", () => {
    it("admits any member of the owning organization", () => {
      assert.deepEqual(decideAccess("ORG", facts({ isOrgMember: true })), {
        allowed: true,
        role: "viewer",
      });
    });

    it("asks an anonymous visitor to sign in", () => {
      assert.deepEqual(decideAccess("ORG", NOBODY), {
        allowed: false,
        reason: "authentication_required",
      });
    });

    it("reports a signed-in outsider as out-of-organization", () => {
      assert.deepEqual(decideAccess("ORG", facts({ isEnrolled: true })), {
        allowed: false,
        reason: "not_in_organization",
      });
    });
  });

  describe("ENROLLED", () => {
    it("admits an enrolled student", () => {
      assert.deepEqual(decideAccess("ENROLLED", facts({ isEnrolled: true })), {
        allowed: true,
        role: "viewer",
      });
    });

    it("asks an anonymous visitor to sign in", () => {
      assert.deepEqual(decideAccess("ENROLLED", NOBODY), {
        allowed: false,
        reason: "authentication_required",
      });
    });

    // The distinction drives the UI: an org member sees "ask to be enrolled",
    // an anonymous visitor sees a sign-in form.
    it("tells a signed-in org member they are simply not enrolled", () => {
      assert.deepEqual(decideAccess("ENROLLED", facts({ isOrgMember: true })), {
        allowed: false,
        reason: "not_enrolled",
      });
    });

    it("does not treat plain org membership as enrollment", () => {
      assert.equal(
        decideAccess("ENROLLED", facts({ isOrgMember: true })).allowed,
        false,
      );
    });
  });

  it("throws rather than defaulting open on an unknown mode", () => {
    assert.throws(
      // Deliberately bypassing the type system to simulate a new enum value
      // arriving from the database before the code is updated.
      () => decideAccess("SOMETHING_NEW" as never, NOBODY),
      /Unhandled access mode/,
    );
  });
});
