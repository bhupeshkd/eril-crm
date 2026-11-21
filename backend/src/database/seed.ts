/**
 * Demo data seed. Usage: npm run seed  (from repo root or backend/)
 * Idempotent: skips if the demo user already exists.
 *
 * Demo login (local development only):
 *   email:    demo@eril.local
 *   password: DemoPass123!
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { ContactsService } from '../crm/contacts.service';
import { SalesService } from '../sales/sales.service';
import { InboxService } from '../communication/inbox.service';
import { WorkflowsService } from '../automation/workflows.service';
import { User } from './entities/user.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';

export const DEMO_EMAIL = 'demo@eril.local';
export const DEMO_PASSWORD = 'DemoPass123!';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const ds = app.get(DataSource);
    if (await ds.getRepository(User).exist({ where: { email: DEMO_EMAIL } })) {
      console.log(`Seed skipped: ${DEMO_EMAIL} already exists.`);
      return;
    }

    await app.get(AuthService).register({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: 'Demo Owner',
      organizationName: 'Acme Agency',
      workspaceName: 'Acme Main',
    });
    const user = await ds.getRepository(User).findOneByOrFail({ email: DEMO_EMAIL });
    const { workspaceId: ws } = await ds
      .getRepository(WorkspaceMember)
      .findOneByOrFail({ userId: user.id });

    const contactsSvc = app.get(ContactsService);
    const people = [
      ['Ava', 'Patel', 'ava@northwind.io', '+15550101', 'Northwind', 'customer', ['vip']],
      ['Liam', 'Chen', 'liam@globex.com', '+15550102', 'Globex', 'lead', ['newsletter']],
      ['Sofia', 'Garcia', 'sofia@initech.com', '+15550103', 'Initech', 'lead', []],
      ['Noah', 'Kim', 'noah@umbrella.co', '+15550104', 'Umbrella', 'customer', ['partner']],
      ['Mia', 'Rossi', 'mia@hooli.com', '+15550105', 'Hooli', 'lead', ['webinar']],
      ['Ethan', 'Brown', 'ethan@stark.io', '+15550106', 'Stark Industries', 'churned', []],
    ] as const;
    const contacts = [];
    for (const [firstName, lastName, email, phone, companyName, status, tags] of people) {
      contacts.push(
        await contactsSvc.create(
          ws,
          { firstName, lastName, email, phone, companyName, status, tags: [...tags] },
          user.id,
        ),
      );
    }

    const sales = app.get(SalesService);
    const [pipeline] = await sales.listPipelines(ws);
    const stage = (name: string) => pipeline.stages.find((s) => s.name === name).id;
    const deals: Array<[string, number, string, number]> = [
      ['Website redesign', 12000, 'Lead', 1],
      ['SEO retainer', 3500, 'Qualified', 4],
      ['CRM migration', 18000, 'Proposal', 0],
      ['Annual support', 9000, 'Negotiation', 3],
      ['Brand refresh', 7500, 'Won', 0],
      ['Ad campaign', 4200, 'Lost', 5],
    ];
    for (const [title, value, stageName, ci] of deals) {
      await sales.createOpportunity(ws, {
        title,
        value,
        pipelineId: pipeline.id,
        stageId: stage(stageName),
        contactId: contacts[ci].id,
      }, user.id);
    }

    const inbox = app.get(InboxService);
    await inbox.send(ws, {
      contactId: contacts[1].id,
      channel: 'email',
      subject: 'Following up on our call',
      body: 'Hi Liam, great speaking today. Attached is the proposal we discussed.',
    }, user.id);
    await inbox.receive(ws, {
      contactId: contacts[1].id,
      channel: 'email',
      subject: 'Following up on our call',
      body: 'Thanks! Can we get on a call Thursday to go over pricing?',
    });
    await inbox.receive(ws, {
      contactId: contacts[4].id,
      channel: 'sms',
      body: 'Hi, is the webinar recording available?',
    });

    const workflows = app.get(WorkflowsService);
    await workflows.create(ws, {
      name: 'Welcome new leads',
      triggerType: 'contact.created',
      isPublished: true,
      steps: [
        {
          id: 'c1',
          type: 'condition',
          config: { field: 'contact.email', operator: 'exists' },
          then: [
            {
              id: 'e1',
              type: 'send_email',
              config: {
                subject: 'Welcome, {{contact.firstName}}!',
                body: 'Hi {{contact.firstName}},\n\nThanks for your interest in Acme Agency. We will be in touch shortly.',
              },
            },
            { id: 't1', type: 'add_tag', config: { tag: 'welcomed' } },
          ],
          else: [{ id: 'l1', type: 'log', config: { message: 'No email for {{contact.firstName}}; skipped welcome' } }],
        },
      ] as any,
    });
    await workflows.create(ws, {
      name: 'Deal won → mark customer',
      triggerType: 'opportunity.stage_changed',
      triggerConfig: { stageId: stage('Won') },
      isPublished: true,
      steps: [
        { id: 'u1', type: 'update_contact', config: { field: 'status', value: 'customer' } },
        {
          id: 'e2',
          type: 'send_email',
          config: { subject: 'Welcome aboard!', body: 'Hi {{contact.firstName}}, thanks for choosing us for "{{opportunity.title}}".' },
        },
      ] as any,
    });

    // Give async listeners a moment to finish before closing.
    await new Promise((r) => setTimeout(r, 500));
    console.log(`Seeded demo workspace. Log in as ${DEMO_EMAIL} (password in src/database/seed.ts).`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
