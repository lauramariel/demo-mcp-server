import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEAL_STAGES } from "./db.js";
import * as crm from "./crm.js";

const dealStageEnum = z.enum(DEAL_STAGES);

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function guard<T>(fn: () => T) {
  try {
    return ok(fn());
  } catch (err) {
    if (err instanceof crm.CrmError) return fail(err.message);
    throw err;
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "demo-crm-mcp-server", version: "1.0.0" });

  // ---- Companies --------------------------------------------------------

  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description: "List CRM companies, optionally filtered by name search or industry.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive substring match on company name"),
        industry: z.string().optional().describe("Exact industry match, e.g. 'Software'"),
      },
    },
    async ({ search, industry }) => guard(() => crm.listCompanies({ search, industry }))
  );

  server.registerTool(
    "get_company",
    {
      title: "Get company",
      description: "Get a company's details along with its contacts and deals.",
      inputSchema: { companyId: z.number().int() },
    },
    async ({ companyId }) => guard(() => crm.getCompany(companyId))
  );

  server.registerTool(
    "create_company",
    {
      title: "Create company",
      description: "Create a new company record in the CRM.",
      inputSchema: {
        name: z.string().min(1),
        industry: z.string().optional(),
        website: z.string().optional(),
      },
    },
    async (input) => guard(() => crm.createCompany(input))
  );

  server.registerTool(
    "update_company",
    {
      title: "Update company",
      description: "Update fields on an existing company. Only provided fields are changed.",
      inputSchema: {
        companyId: z.number().int(),
        name: z.string().optional(),
        industry: z.string().optional(),
        website: z.string().optional(),
      },
    },
    async ({ companyId, ...patch }) => guard(() => crm.updateCompany(companyId, patch))
  );

  // ---- Contacts -----------------------------------------------------------

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description: "List CRM contacts, optionally filtered by company or a name/email search.",
      inputSchema: {
        companyId: z.number().int().optional(),
        search: z.string().optional(),
      },
    },
    async ({ companyId, search }) => guard(() => crm.listContacts({ companyId, search }))
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get contact",
      description: "Get a contact's details along with their company, deals, and activity history.",
      inputSchema: { contactId: z.number().int() },
    },
    async ({ contactId }) => guard(() => crm.getContact(contactId))
  );

  server.registerTool(
    "create_contact",
    {
      title: "Create contact",
      description: "Create a new contact, optionally attached to a company.",
      inputSchema: {
        name: z.string().min(1),
        companyId: z.number().int().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        title: z.string().optional(),
      },
    },
    async (input) => guard(() => crm.createContact(input))
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update contact",
      description: "Update fields on an existing contact. Only provided fields are changed.",
      inputSchema: {
        contactId: z.number().int(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        title: z.string().optional(),
        companyId: z.number().int().optional(),
      },
    },
    async ({ contactId, ...patch }) => guard(() => crm.updateContact(contactId, patch))
  );

  // ---- Deals --------------------------------------------------------------

  server.registerTool(
    "list_deals",
    {
      title: "List deals",
      description: "List deals in the sales pipeline, optionally filtered by company or stage.",
      inputSchema: {
        companyId: z.number().int().optional(),
        stage: dealStageEnum.optional(),
      },
    },
    async ({ companyId, stage }) => guard(() => crm.listDeals({ companyId, stage }))
  );

  server.registerTool(
    "get_deal",
    {
      title: "Get deal",
      description: "Get a deal's details along with its company, contact, and activity history.",
      inputSchema: { dealId: z.number().int() },
    },
    async ({ dealId }) => guard(() => crm.getDeal(dealId))
  );

  server.registerTool(
    "create_deal",
    {
      title: "Create deal",
      description: "Create a new deal for a company, optionally linked to a contact.",
      inputSchema: {
        companyId: z.number().int(),
        name: z.string().min(1),
        contactId: z.number().int().optional(),
        stage: dealStageEnum.optional().describe("Defaults to 'lead'"),
        amountCents: z.number().int().nonnegative().optional().describe("Deal value in cents"),
      },
    },
    async (input) => guard(() => crm.createDeal(input))
  );

  server.registerTool(
    "update_deal_stage",
    {
      title: "Update deal stage",
      description: `Move a deal to a new pipeline stage. Valid stages: ${DEAL_STAGES.join(", ")}.`,
      inputSchema: { dealId: z.number().int(), stage: dealStageEnum },
    },
    async ({ dealId, stage }) => guard(() => crm.updateDealStage(dealId, stage))
  );

  // ---- Activities -----------------------------------------------------

  server.registerTool(
    "log_activity",
    {
      title: "Log activity",
      description: "Log a note, call, email, or meeting against a company, contact, or deal.",
      inputSchema: {
        entityType: z.enum(["company", "contact", "deal"]),
        entityId: z.number().int(),
        type: z.enum(["note", "call", "email", "meeting"]),
        content: z.string().min(1),
      },
    },
    async (input) => guard(() => crm.logActivity(input))
  );

  // ---- Search & reporting -----------------------------------------------

  server.registerTool(
    "search_crm",
    {
      title: "Search CRM",
      description: "Full-text-ish search across companies, contacts, and deals by name/email/title.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => guard(() => crm.searchCrm(query))
  );

  server.registerTool(
    "get_pipeline_summary",
    {
      title: "Get pipeline summary",
      description: "Get aggregate pipeline stats: deal count and total value per stage, plus open/won totals.",
      inputSchema: {},
    },
    async () => guard(() => crm.getPipelineSummary())
  );

  return server;
}
