import { MigrationInterface, QueryRunner } from "typeorm";

export class GhlBatch11794815921606 implements MigrationInterface {
    name = 'GhlBatch11794815921606'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "description" text NOT NULL DEFAULT '', "price" numeric(15,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "interval" character varying(10) NOT NULL DEFAULT 'one_time', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e2f7cafd00ba25aa07eec2ac91" ON "products" ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "number" character varying(30) NOT NULL, "contact_id" uuid NOT NULL, "items" jsonb NOT NULL DEFAULT '[]', "currency" character varying(3) NOT NULL DEFAULT 'USD', "subtotal" numeric(15,2) NOT NULL DEFAULT '0', "tax_rate" numeric(5,2) NOT NULL DEFAULT '0', "tax" numeric(15,2) NOT NULL DEFAULT '0', "discount" numeric(15,2) NOT NULL DEFAULT '0', "total" numeric(15,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'draft', "due_date" date, "notes" text NOT NULL DEFAULT '', "public_token" character varying(64) NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE, "payment_method" character varying(20), "stripe_session_id" character varying(255), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5e675ecc54475ef1661fe682a9" ON "invoices" ("public_token") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_944ef9a6c6cfda7a91f715d6dc" ON "invoices" ("workspace_id", "number") `);
        await queryRunner.query(`CREATE TABLE "forms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(120) NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'form', "description" text NOT NULL DEFAULT '', "fields" jsonb NOT NULL DEFAULT '[]', "settings" jsonb NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "submission_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_ba062fd30b06814a60756f233da" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_beb11480ce7ba6813fe893723a" ON "forms" ("slug") `);
        await queryRunner.query(`CREATE TABLE "form_submissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "form_id" uuid NOT NULL, "contact_id" uuid, "data" jsonb NOT NULL, "ip_address" character varying(64), CONSTRAINT "PK_fb6e1e9f26cda31c358a8a1530e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_92ffc7d792657d806adbde39f1" ON "form_submissions" ("form_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "custom_fields" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "key" character varying(64) NOT NULL, "label" character varying(120) NOT NULL, "type" character varying(20) NOT NULL DEFAULT 'text', "options" text array NOT NULL DEFAULT '{}', "position" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_35ab958a0baec2e0b2b2b875fdb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_504f76c9de76621023c89cf7aa" ON "custom_fields" ("workspace_id", "key") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "contact_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "body" text NOT NULL, "user_id" uuid, CONSTRAINT "PK_263505a5e2d3aa2e4dde9a6bd04" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4f40925722bca7837e7786fcb2" ON "contact_notes" ("contact_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "description" text, "contact_id" uuid, "assignee_id" uuid, "due_at" TIMESTAMP WITH TIME ZONE, "completed" boolean NOT NULL DEFAULT false, "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_60098b828b070b69ac705ad3fe" ON "tasks" ("workspace_id", "completed", "due_at") `);
        await queryRunner.query(`CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "channel" character varying(10) NOT NULL DEFAULT 'email', "subject" character varying(255) NOT NULL DEFAULT '', "body" text NOT NULL DEFAULT '', "audience" jsonb NOT NULL DEFAULT '{}', "status" character varying(12) NOT NULL DEFAULT 'draft', "scheduled_at" TIMESTAMP WITH TIME ZONE, "sent_at" TIMESTAMP WITH TIME ZONE, "stats" jsonb NOT NULL DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}', CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6472462b070047dff7787882f6" ON "campaigns" ("workspace_id", "status") `);
        await queryRunner.query(`CREATE TABLE "calendars" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(120) NOT NULL, "description" text NOT NULL DEFAULT '', "duration_minutes" integer NOT NULL DEFAULT '30', "slot_interval_minutes" integer NOT NULL DEFAULT '30', "buffer_minutes" integer NOT NULL DEFAULT '0', "min_notice_hours" integer NOT NULL DEFAULT '2', "booking_window_days" integer NOT NULL DEFAULT '60', "timezone" character varying(64) NOT NULL DEFAULT 'UTC', "availability" jsonb NOT NULL DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}', "send_confirmation" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "location" character varying(500) NOT NULL DEFAULT '', CONSTRAINT "PK_90dc0330e8ec9028e23c290dee8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f9d50d55bcfe2c4bf952b833e8" ON "calendars" ("slug") `);
        await queryRunner.query(`CREATE TABLE "appointments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "calendar_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'booked', "notes" text, "source" character varying(30) NOT NULL DEFAULT 'manual', CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0507c6531ec454d291a861a391" ON "appointments" ("calendar_id", "start_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_ad2c53a76323c03a42432174fa" ON "appointments" ("workspace_id", "start_at") `);
        await queryRunner.query(`ALTER TABLE "workflow_runs" ADD "resume_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "workflow_runs" ADD "pending" jsonb`);
        await queryRunner.query(`ALTER TABLE "workflow_runs" ADD "depth" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "custom_fields" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "source" character varying(50) NOT NULL DEFAULT 'manual'`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "dnd" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD CONSTRAINT "FK_e77a60f5d7e813639d8ba05e6e9" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "form_submissions" ADD CONSTRAINT "FK_e3a9b528e76dfd1b269539f2940" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "contact_notes" ADD CONSTRAINT "FK_073b47f6c912ee4b307c2aba3cb" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_5489b511b5347d806677939151f" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "appointments" ADD CONSTRAINT "FK_1398c0b45fcb8468f610c235edc" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "appointments" ADD CONSTRAINT "FK_ba5b2709e550a32c815bc6d82e0" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_ba5b2709e550a32c815bc6d82e0"`);
        await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_1398c0b45fcb8468f610c235edc"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_5489b511b5347d806677939151f"`);
        await queryRunner.query(`ALTER TABLE "contact_notes" DROP CONSTRAINT "FK_073b47f6c912ee4b307c2aba3cb"`);
        await queryRunner.query(`ALTER TABLE "form_submissions" DROP CONSTRAINT "FK_e3a9b528e76dfd1b269539f2940"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT "FK_e77a60f5d7e813639d8ba05e6e9"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "dnd"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "source"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "custom_fields"`);
        await queryRunner.query(`ALTER TABLE "workflow_runs" DROP COLUMN "depth"`);
        await queryRunner.query(`ALTER TABLE "workflow_runs" DROP COLUMN "pending"`);
        await queryRunner.query(`ALTER TABLE "workflow_runs" DROP COLUMN "resume_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ad2c53a76323c03a42432174fa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0507c6531ec454d291a861a391"`);
        await queryRunner.query(`DROP TABLE "appointments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f9d50d55bcfe2c4bf952b833e8"`);
        await queryRunner.query(`DROP TABLE "calendars"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6472462b070047dff7787882f6"`);
        await queryRunner.query(`DROP TABLE "campaigns"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_60098b828b070b69ac705ad3fe"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4f40925722bca7837e7786fcb2"`);
        await queryRunner.query(`DROP TABLE "contact_notes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_504f76c9de76621023c89cf7aa"`);
        await queryRunner.query(`DROP TABLE "custom_fields"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_92ffc7d792657d806adbde39f1"`);
        await queryRunner.query(`DROP TABLE "form_submissions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_beb11480ce7ba6813fe893723a"`);
        await queryRunner.query(`DROP TABLE "forms"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_944ef9a6c6cfda7a91f715d6dc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5e675ecc54475ef1661fe682a9"`);
        await queryRunner.query(`DROP TABLE "invoices"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2f7cafd00ba25aa07eec2ac91"`);
        await queryRunner.query(`DROP TABLE "products"`);
    }

}
