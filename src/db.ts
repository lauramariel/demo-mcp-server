import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, "crm.db");
const isNewDb = !existsSync(dbPath);

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    website TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'lead',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const DEAL_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

if (isNewDb) {
  seed();
}

function seed() {
  const insertCompany = db.prepare(
    "INSERT INTO companies (name, industry, website) VALUES (?, ?, ?)"
  );
  const companies = [
    ["Acme Robotics", "Manufacturing", "acmerobotics.example"],
    ["Northwind Traders", "Retail", "northwindtraders.example"],
    ["BluePeak Analytics", "Software", "bluepeak.example"],
    ["Cascade Health Group", "Healthcare", "cascadehealth.example"],
    ["Fenwick & Ito Law", "Legal Services", "fenwickito.example"],
  ] as const;
  const companyIds = companies.map(
    (c) => insertCompany.run(...c).lastInsertRowid as number
  );

  const insertContact = db.prepare(
    "INSERT INTO contacts (company_id, name, email, phone, title) VALUES (?, ?, ?, ?, ?)"
  );
  const contacts = [
    [companyIds[0], "Priya Nair", "priya.nair@acmerobotics.example", "555-0101", "VP Engineering"],
    [companyIds[0], "Sam Whitfield", "sam.whitfield@acmerobotics.example", "555-0102", "Procurement Lead"],
    [companyIds[1], "Diego Alvarez", "diego.alvarez@northwindtraders.example", "555-0201", "COO"],
    [companyIds[2], "Mei Lin Chen", "mei.chen@bluepeak.example", "555-0301", "CEO"],
    [companyIds[2], "Jonas Berg", "jonas.berg@bluepeak.example", "555-0302", "Head of Data"],
    [companyIds[3], "Aisha Rahman", "aisha.rahman@cascadehealth.example", "555-0401", "Director of IT"],
    [companyIds[4], "Tom Fenwick", "tom.fenwick@fenwickito.example", "555-0501", "Managing Partner"],
  ] as const;
  const contactIds = contacts.map(
    (c) => insertContact.run(...c).lastInsertRowid as number
  );

  const insertDeal = db.prepare(
    "INSERT INTO deals (company_id, contact_id, name, stage, amount_cents) VALUES (?, ?, ?, ?, ?)"
  );
  const deals = [
    [companyIds[0], contactIds[0], "Robotics fleet monitoring rollout", "negotiation", 4_800_000],
    [companyIds[1], contactIds[2], "POS system upgrade", "proposal", 1_250_000],
    [companyIds[2], contactIds[3], "Analytics platform license (annual)", "won", 960_000],
    [companyIds[2], contactIds[4], "Data pipeline consulting", "qualified", 320_000],
    [companyIds[3], contactIds[5], "Patient records integration", "lead", 2_100_000],
    [companyIds[4], contactIds[6], "Contract management tooling", "lost", 180_000],
  ] as const;
  const dealIds = deals.map(
    (d) => insertDeal.run(...d).lastInsertRowid as number
  );

  const insertActivity = db.prepare(
    "INSERT INTO activities (entity_type, entity_id, type, content) VALUES (?, ?, ?, ?)"
  );
  const activities: [string, number, string, string][] = [
    ["deal", dealIds[0], "call", "Discussed rollout timeline; Priya wants pilot in 2 sites first."],
    ["deal", dealIds[0], "note", "Legal reviewing MSA redlines, expect signature next week."],
    ["deal", dealIds[1], "email", "Sent updated quote reflecting 3-terminal discount."],
    ["contact", contactIds[3], "meeting", "Kickoff call with Mei Lin Chen went well, strong champion."],
    ["deal", dealIds[2], "note", "Contract signed and countersigned, onboarding scheduled."],
    ["deal", dealIds[4], "call", "Aisha flagged HIPAA compliance as a blocker to resolve before proposal."],
    ["company", companyIds[4], "note", "Fenwick & Ito paused budget for the quarter; revisit in Q1."],
  ];
  for (const a of activities) insertActivity.run(...a);
}
