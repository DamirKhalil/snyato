import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const studioWorkspaces = sqliteTable('studio_workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  ownerEmail: text('owner_email').notNull(),
  ownerName: text('owner_name').notNull(),
  stateJson: text('state_json').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const studioMembers = sqliteTable('studio_members', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull().default('editor'),
  createdAt: text('created_at').notNull(),
});
