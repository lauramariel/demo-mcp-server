import { db, DEAL_STAGES, type DealStage } from "./db.js";

export interface Company {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  created_at: string;
}

export interface Contact {
  id: number;
  company_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  created_at: string;
}

export interface Deal {
  id: number;
  company_id: number | null;
  contact_id: number | null;
  name: string;
  stage: DealStage;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  entity_type: string;
  entity_id: number;
  type: string;
  content: string;
  created_at: string;
}

export class CrmError extends Error {}

// ---- Companies ----------------------------------------------------------

export function listCompanies(opts: { search?: string; industry?: string } = {}): Company[] {
  let query = "SELECT * FROM companies WHERE 1=1";
  const params: (string | number)[] = [];
  if (opts.search) {
    query += " AND name LIKE ?";
    params.push(`%${opts.search}%`);
  }
  if (opts.industry) {
    query += " AND industry = ?";
    params.push(opts.industry);
  }
  query += " ORDER BY name";
  return db.prepare(query).all(...params) as unknown as Company[];
}

export function getCompany(id: number) {
  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as Company | undefined;
  if (!company) throw new CrmError(`No company with id ${id}`);
  const contacts = db.prepare("SELECT * FROM contacts WHERE company_id = ? ORDER BY name").all(id) as unknown as Contact[];
  const deals = db.prepare("SELECT * FROM deals WHERE company_id = ? ORDER BY updated_at DESC").all(id) as unknown as Deal[];
  return { ...company, contacts, deals };
}

export function createCompany(input: { name: string; industry?: string; website?: string }): Company {
  const result = db
    .prepare("INSERT INTO companies (name, industry, website) VALUES (?, ?, ?)")
    .run(input.name, input.industry ?? null, input.website ?? null);
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(result.lastInsertRowid) as unknown as Company;
}

export function updateCompany(
  id: number,
  patch: { name?: string; industry?: string; website?: string }
): Company {
  const existing = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as Company | undefined;
  if (!existing) throw new CrmError(`No company with id ${id}`);
  db.prepare("UPDATE companies SET name = ?, industry = ?, website = ? WHERE id = ?").run(
    patch.name ?? existing.name,
    patch.industry ?? existing.industry,
    patch.website ?? existing.website,
    id
  );
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as unknown as Company;
}

// ---- Contacts ------------------------------------------------------------

export function listContacts(opts: { companyId?: number; search?: string } = {}): Contact[] {
  let query = "SELECT * FROM contacts WHERE 1=1";
  const params: (string | number)[] = [];
  if (opts.companyId !== undefined) {
    query += " AND company_id = ?";
    params.push(opts.companyId);
  }
  if (opts.search) {
    query += " AND (name LIKE ? OR email LIKE ?)";
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  query += " ORDER BY name";
  return db.prepare(query).all(...params) as unknown as Contact[];
}

export function getContact(id: number) {
  const contact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Contact | undefined;
  if (!contact) throw new CrmError(`No contact with id ${id}`);
  const company = contact.company_id
    ? (db.prepare("SELECT * FROM companies WHERE id = ?").get(contact.company_id) as Company | undefined)
    : null;
  const deals = db.prepare("SELECT * FROM deals WHERE contact_id = ? ORDER BY updated_at DESC").all(id) as unknown as Deal[];
  const activities = listActivitiesFor("contact", id);
  return { ...contact, company: company ?? null, deals, activities };
}

export function createContact(input: {
  companyId?: number;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
}): Contact {
  if (input.companyId !== undefined) {
    const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(input.companyId);
    if (!company) throw new CrmError(`No company with id ${input.companyId}`);
  }
  const result = db
    .prepare("INSERT INTO contacts (company_id, name, email, phone, title) VALUES (?, ?, ?, ?, ?)")
    .run(input.companyId ?? null, input.name, input.email ?? null, input.phone ?? null, input.title ?? null);
  return db.prepare("SELECT * FROM contacts WHERE id = ?").get(result.lastInsertRowid) as unknown as Contact;
}

export function updateContact(
  id: number,
  patch: { name?: string; email?: string; phone?: string; title?: string; companyId?: number }
): Contact {
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Contact | undefined;
  if (!existing) throw new CrmError(`No contact with id ${id}`);
  db.prepare(
    "UPDATE contacts SET name = ?, email = ?, phone = ?, title = ?, company_id = ? WHERE id = ?"
  ).run(
    patch.name ?? existing.name,
    patch.email ?? existing.email,
    patch.phone ?? existing.phone,
    patch.title ?? existing.title,
    patch.companyId ?? existing.company_id,
    id
  );
  return db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as unknown as Contact;
}

// ---- Deals -----------------------------------------------------------

export function listDeals(opts: { companyId?: number; stage?: DealStage } = {}): Deal[] {
  let query = "SELECT * FROM deals WHERE 1=1";
  const params: (string | number)[] = [];
  if (opts.companyId !== undefined) {
    query += " AND company_id = ?";
    params.push(opts.companyId);
  }
  if (opts.stage) {
    query += " AND stage = ?";
    params.push(opts.stage);
  }
  query += " ORDER BY updated_at DESC";
  return db.prepare(query).all(...params) as unknown as Deal[];
}

export function getDeal(id: number) {
  const deal = db.prepare("SELECT * FROM deals WHERE id = ?").get(id) as Deal | undefined;
  if (!deal) throw new CrmError(`No deal with id ${id}`);
  const company = deal.company_id
    ? (db.prepare("SELECT * FROM companies WHERE id = ?").get(deal.company_id) as Company | undefined)
    : null;
  const contact = deal.contact_id
    ? (db.prepare("SELECT * FROM contacts WHERE id = ?").get(deal.contact_id) as Contact | undefined)
    : null;
  const activities = listActivitiesFor("deal", id);
  return { ...deal, company: company ?? null, contact: contact ?? null, activities };
}

export function createDeal(input: {
  companyId: number;
  contactId?: number;
  name: string;
  stage?: DealStage;
  amountCents?: number;
}): Deal {
  const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(input.companyId);
  if (!company) throw new CrmError(`No company with id ${input.companyId}`);
  const stage = input.stage ?? "lead";
  if (!DEAL_STAGES.includes(stage)) {
    throw new CrmError(`Invalid stage "${stage}". Valid stages: ${DEAL_STAGES.join(", ")}`);
  }
  const result = db
    .prepare("INSERT INTO deals (company_id, contact_id, name, stage, amount_cents) VALUES (?, ?, ?, ?, ?)")
    .run(input.companyId, input.contactId ?? null, input.name, stage, input.amountCents ?? 0);
  return db.prepare("SELECT * FROM deals WHERE id = ?").get(result.lastInsertRowid) as unknown as Deal;
}

export function updateDealStage(id: number, stage: DealStage): Deal {
  if (!DEAL_STAGES.includes(stage)) {
    throw new CrmError(`Invalid stage "${stage}". Valid stages: ${DEAL_STAGES.join(", ")}`);
  }
  const existing = db.prepare("SELECT * FROM deals WHERE id = ?").get(id);
  if (!existing) throw new CrmError(`No deal with id ${id}`);
  db.prepare("UPDATE deals SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, id);
  return db.prepare("SELECT * FROM deals WHERE id = ?").get(id) as unknown as Deal;
}

// ---- Activities ------------------------------------------------------

function listActivitiesFor(entityType: string, entityId: number): Activity[] {
  return db
    .prepare("SELECT * FROM activities WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC")
    .all(entityType, entityId) as unknown as Activity[];
}

export function logActivity(input: {
  entityType: "company" | "contact" | "deal";
  entityId: number;
  type: "note" | "call" | "email" | "meeting";
  content: string;
}): Activity {
  const table = input.entityType === "company" ? "companies" : input.entityType === "contact" ? "contacts" : "deals";
  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(input.entityId);
  if (!exists) throw new CrmError(`No ${input.entityType} with id ${input.entityId}`);
  const result = db
    .prepare("INSERT INTO activities (entity_type, entity_id, type, content) VALUES (?, ?, ?, ?)")
    .run(input.entityType, input.entityId, input.type, input.content);
  return db.prepare("SELECT * FROM activities WHERE id = ?").get(result.lastInsertRowid) as unknown as Activity;
}

// ---- Search & reporting -----------------------------------------------

export function searchCrm(query: string) {
  const like = `%${query}%`;
  const companies = db
    .prepare("SELECT * FROM companies WHERE name LIKE ? OR industry LIKE ?")
    .all(like, like) as unknown as Company[];
  const contacts = db
    .prepare("SELECT * FROM contacts WHERE name LIKE ? OR email LIKE ? OR title LIKE ?")
    .all(like, like, like) as unknown as Contact[];
  const deals = db.prepare("SELECT * FROM deals WHERE name LIKE ?").all(like) as unknown as Deal[];
  return { companies, contacts, deals };
}

export function getPipelineSummary() {
  const rows = db
    .prepare(
      "SELECT stage, COUNT(*) as count, SUM(amount_cents) as total_cents FROM deals GROUP BY stage"
    )
    .all() as unknown as { stage: DealStage; count: number; total_cents: number }[];

  const byStage = Object.fromEntries(
    DEAL_STAGES.map((stage) => {
      const row = rows.find((r) => r.stage === stage);
      return [stage, { count: row?.count ?? 0, total_cents: row?.total_cents ?? 0 }];
    })
  );

  const openStages = DEAL_STAGES.filter((s) => s !== "won" && s !== "lost");
  const openTotalCents = openStages.reduce((sum, s) => sum + (byStage[s]?.total_cents ?? 0), 0);
  const wonTotalCents = byStage["won"]?.total_cents ?? 0;

  return { byStage, openTotalCents, wonTotalCents };
}
