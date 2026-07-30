/**
 * Starter seed data for lists and a few vendor→category defaults.
 * All rows are is_seed = 1. Modest and useful — not a scraped dump.
 *
 * Apply with applySeed(db). Safe to call once on a fresh library.
 */

import type { Database } from '../db/repo/types.ts'
import { normalizeVendorName } from '../db/repo/normalize.ts'

export interface SeedCategory {
  name: string
  parent?: string
}

export interface SeedTaxCategory {
  name: string
  formRef?: string
}

export interface SeedPaymentType {
  name: string
}

export interface SeedVendor {
  name: string
  defaultCategory: string
}

export interface SeedRule {
  kind: 'vendor_to_category'
  matchVendor: string
  category: string
  priority: number
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Office Supplies' },
  { name: 'Materials' },
  { name: 'Fuel' },
  { name: 'Travel' },
  { name: 'Meals & Entertainment' },
  { name: 'Software & Subscriptions' },
  { name: 'Professional Services' },
  { name: 'Utilities' },
  { name: 'Insurance' },
  { name: 'Equipment' },
  { name: 'Shipping & Postage' },
  { name: 'Advertising & Marketing' },
  { name: 'Vehicle Expenses' },
  { name: 'Repairs & Maintenance' },
  { name: 'Rent & Lease' },
  { name: 'Payroll & Benefits' },
  { name: 'Bank Fees' },
  { name: 'Taxes & Licenses' },
  { name: 'Training & Education' },
  { name: 'Telecommunications' },
  { name: 'Medical' },
  { name: 'Charitable Contributions' },
  { name: 'Personal (Non-deductible)' },
  { name: 'Uncategorized' },
]

export const SEED_TAX_CATEGORIES: SeedTaxCategory[] = [
  { name: 'Cost of Goods Sold', formRef: 'Schedule C L4' },
  { name: 'Advertising', formRef: 'Schedule C L8' },
  { name: 'Car and Truck Expenses', formRef: 'Schedule C L9' },
  { name: 'Commissions and Fees', formRef: 'Schedule C L10' },
  { name: 'Contract Labor', formRef: 'Schedule C L11' },
  { name: 'Depletion', formRef: 'Schedule C L12' },
  { name: 'Depreciation', formRef: 'Schedule C L13' },
  { name: 'Employee Benefit Programs', formRef: 'Schedule C L14' },
  { name: 'Insurance (other than health)', formRef: 'Schedule C L15' },
  { name: 'Interest — Mortgage', formRef: 'Schedule C L16a' },
  { name: 'Interest — Other', formRef: 'Schedule C L16b' },
  { name: 'Legal and Professional Services', formRef: 'Schedule C L17' },
  { name: 'Office Expense', formRef: 'Schedule C L18' },
  { name: 'Pension and Profit-Sharing', formRef: 'Schedule C L19' },
  { name: 'Rent — Vehicles / Machinery', formRef: 'Schedule C L20a' },
  { name: 'Rent — Other Business Property', formRef: 'Schedule C L20b' },
  { name: 'Repairs and Maintenance', formRef: 'Schedule C L21' },
  { name: 'Supplies', formRef: 'Schedule C L22' },
  { name: 'Taxes and Licenses', formRef: 'Schedule C L23' },
  { name: 'Travel', formRef: 'Schedule C L24a' },
  { name: 'Meals', formRef: 'Schedule C L24b' },
  { name: 'Utilities', formRef: 'Schedule C L25' },
  { name: 'Wages', formRef: 'Schedule C L26' },
  { name: 'Other Expenses', formRef: 'Schedule C L27a' },
  { name: 'Non-deductible', formRef: undefined },
  { name: 'Capital Expenditure', formRef: undefined },
  { name: 'Sales Tax Paid', formRef: undefined },
]

export const SEED_PAYMENT_TYPES: SeedPaymentType[] = [
  { name: 'Cash' },
  { name: 'Check' },
  { name: 'Visa' },
  { name: 'Mastercard' },
  { name: 'American Express' },
  { name: 'Discover' },
  { name: 'Debit Card' },
  { name: 'ACH / Bank Transfer' },
  { name: 'PayPal' },
  { name: 'Venmo' },
  { name: 'Apple Pay' },
  { name: 'Google Pay' },
  { name: 'Wire Transfer' },
  { name: 'Store Credit' },
  { name: 'Other' },
]

/** ~90 common US vendors with sensible default categories. */
export const SEED_VENDORS: SeedVendor[] = [
  // Office / supplies
  { name: 'Staples', defaultCategory: 'Office Supplies' },
  { name: 'Office Depot', defaultCategory: 'Office Supplies' },
  { name: 'OfficeMax', defaultCategory: 'Office Supplies' },
  { name: 'Amazon', defaultCategory: 'Office Supplies' },
  { name: 'Amazon Web Services', defaultCategory: 'Software & Subscriptions' },
  { name: 'Walmart', defaultCategory: 'Materials' },
  { name: 'Target', defaultCategory: 'Materials' },
  { name: 'Costco', defaultCategory: 'Materials' },
  { name: 'Sam\'s Club', defaultCategory: 'Materials' },
  // Building materials
  { name: 'Home Depot', defaultCategory: 'Materials' },
  { name: 'Lowe\'s', defaultCategory: 'Materials' },
  { name: 'Ace Hardware', defaultCategory: 'Materials' },
  { name: 'Menards', defaultCategory: 'Materials' },
  { name: 'Harbor Freight', defaultCategory: 'Equipment' },
  { name: 'Grainger', defaultCategory: 'Materials' },
  { name: 'Fastenal', defaultCategory: 'Materials' },
  // Fuel
  { name: 'Shell', defaultCategory: 'Fuel' },
  { name: 'Exxon', defaultCategory: 'Fuel' },
  { name: 'ExxonMobil', defaultCategory: 'Fuel' },
  { name: 'Chevron', defaultCategory: 'Fuel' },
  { name: 'BP', defaultCategory: 'Fuel' },
  { name: 'Mobil', defaultCategory: 'Fuel' },
  { name: 'Sunoco', defaultCategory: 'Fuel' },
  { name: 'Valero', defaultCategory: 'Fuel' },
  { name: 'Marathon', defaultCategory: 'Fuel' },
  { name: 'Wawa', defaultCategory: 'Fuel' },
  { name: 'Sheetz', defaultCategory: 'Fuel' },
  { name: 'QuikTrip', defaultCategory: 'Fuel' },
  { name: 'RaceTrac', defaultCategory: 'Fuel' },
  // Shipping
  { name: 'UPS', defaultCategory: 'Shipping & Postage' },
  { name: 'FedEx', defaultCategory: 'Shipping & Postage' },
  { name: 'USPS', defaultCategory: 'Shipping & Postage' },
  { name: 'DHL', defaultCategory: 'Shipping & Postage' },
  // Telecom
  { name: 'Verizon', defaultCategory: 'Telecommunications' },
  { name: 'AT&T', defaultCategory: 'Telecommunications' },
  { name: 'T-Mobile', defaultCategory: 'Telecommunications' },
  { name: 'Comcast', defaultCategory: 'Telecommunications' },
  { name: 'Spectrum', defaultCategory: 'Telecommunications' },
  // Software / SaaS
  { name: 'Microsoft', defaultCategory: 'Software & Subscriptions' },
  { name: 'Adobe', defaultCategory: 'Software & Subscriptions' },
  { name: 'Google', defaultCategory: 'Software & Subscriptions' },
  { name: 'Apple', defaultCategory: 'Software & Subscriptions' },
  { name: 'Dropbox', defaultCategory: 'Software & Subscriptions' },
  { name: 'Slack', defaultCategory: 'Software & Subscriptions' },
  { name: 'Zoom', defaultCategory: 'Software & Subscriptions' },
  { name: 'GitHub', defaultCategory: 'Software & Subscriptions' },
  { name: 'Notion', defaultCategory: 'Software & Subscriptions' },
  { name: 'Intuit', defaultCategory: 'Software & Subscriptions' },
  { name: 'QuickBooks', defaultCategory: 'Software & Subscriptions' },
  // Travel
  { name: 'Uber', defaultCategory: 'Travel' },
  { name: 'Lyft', defaultCategory: 'Travel' },
  { name: 'Delta Air Lines', defaultCategory: 'Travel' },
  { name: 'United Airlines', defaultCategory: 'Travel' },
  { name: 'American Airlines', defaultCategory: 'Travel' },
  { name: 'Southwest Airlines', defaultCategory: 'Travel' },
  { name: 'Hilton', defaultCategory: 'Travel' },
  { name: 'Marriott', defaultCategory: 'Travel' },
  { name: 'Airbnb', defaultCategory: 'Travel' },
  { name: 'Enterprise Rent-A-Car', defaultCategory: 'Travel' },
  { name: 'Hertz', defaultCategory: 'Travel' },
  // Meals
  { name: 'Starbucks', defaultCategory: 'Meals & Entertainment' },
  { name: 'McDonald\'s', defaultCategory: 'Meals & Entertainment' },
  { name: 'Chipotle', defaultCategory: 'Meals & Entertainment' },
  { name: 'Panera Bread', defaultCategory: 'Meals & Entertainment' },
  { name: 'Dunkin\'', defaultCategory: 'Meals & Entertainment' },
  { name: 'Subway', defaultCategory: 'Meals & Entertainment' },
  // Utilities
  { name: 'PG&E', defaultCategory: 'Utilities' },
  { name: 'Con Edison', defaultCategory: 'Utilities' },
  { name: 'Duke Energy', defaultCategory: 'Utilities' },
  // Banks / fees
  { name: 'Chase', defaultCategory: 'Bank Fees' },
  { name: 'Bank of America', defaultCategory: 'Bank Fees' },
  { name: 'Wells Fargo', defaultCategory: 'Bank Fees' },
  { name: 'Stripe', defaultCategory: 'Bank Fees' },
  { name: 'PayPal', defaultCategory: 'Bank Fees' },
  // Auto
  { name: 'AutoZone', defaultCategory: 'Vehicle Expenses' },
  { name: 'O\'Reilly Auto Parts', defaultCategory: 'Vehicle Expenses' },
  { name: 'Jiffy Lube', defaultCategory: 'Vehicle Expenses' },
  // Misc retail / pro
  { name: 'Best Buy', defaultCategory: 'Equipment' },
  { name: 'Apple Store', defaultCategory: 'Equipment' },
  { name: 'CVS', defaultCategory: 'Medical' },
  { name: 'Walgreens', defaultCategory: 'Medical' },
  { name: 'LinkedIn', defaultCategory: 'Advertising & Marketing' },
  { name: 'Facebook Ads', defaultCategory: 'Advertising & Marketing' },
  { name: 'Google Ads', defaultCategory: 'Advertising & Marketing' },
  { name: 'Indeed', defaultCategory: 'Professional Services' },
  { name: 'Fiverr', defaultCategory: 'Professional Services' },
  { name: 'Upwork', defaultCategory: 'Professional Services' },
]

export function applySeed(db: Database, now = Date.now()): {
  categories: number
  taxCategories: number
  paymentTypes: number
  vendors: number
} {
  const catIds = new Map<string, number>()

  const insCat = db.prepare(
    `INSERT INTO category(name, is_seed, created_at) VALUES (?, 1, ?)
     ON CONFLICT(name) DO NOTHING`,
  )
  const getCat = db.prepare(`SELECT id FROM category WHERE name = ?`)

  for (const c of SEED_CATEGORIES) {
    insCat.run(c.name, now)
    const row = getCat.get(c.name) as { id: number } | undefined
    if (row) catIds.set(c.name, row.id)
  }

  const insTax = db.prepare(
    `INSERT INTO tax_category(name, form_ref, is_seed, created_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(name) DO NOTHING`,
  )
  for (const t of SEED_TAX_CATEGORIES) {
    insTax.run(t.name, t.formRef ?? null, now)
  }

  const insPay = db.prepare(
    `INSERT INTO payment_type(name, is_seed, created_at) VALUES (?, 1, ?)
     ON CONFLICT(name) DO NOTHING`,
  )
  for (const p of SEED_PAYMENT_TYPES) {
    insPay.run(p.name, now)
  }

  const insVendor = db.prepare(
    `INSERT INTO vendor(name, normalized_name, default_category_id, is_seed, created_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(name) DO NOTHING`,
  )
  let vendors = 0
  for (const v of SEED_VENDORS) {
    const catId = catIds.get(v.defaultCategory) ?? null
    const r = insVendor.run(v.name, normalizeVendorName(v.name), catId, now)
    if (r.changes > 0) vendors++
  }

  return {
    categories: SEED_CATEGORIES.length,
    taxCategories: SEED_TAX_CATEGORIES.length,
    paymentTypes: SEED_PAYMENT_TYPES.length,
    vendors,
  }
}
