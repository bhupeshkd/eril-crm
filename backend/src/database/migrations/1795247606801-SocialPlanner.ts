import { MigrationInterface, QueryRunner } from "typeorm";

export class SocialPlanner1795247606801 implements MigrationInterface {
    name = 'SocialPlanner1795247606801'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "social_posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "body" text NOT NULL DEFAULT '', "link" character varying(1000), "image_url" character varying(1000), "targets" jsonb NOT NULL DEFAULT '[]', "status" character varying(12) NOT NULL DEFAULT 'draft', "scheduled_at" TIMESTAMP WITH TIME ZONE, "published_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, CONSTRAINT "PK_2161864ea79f14525b8804bd7ff" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0c07cc42790f7bde7431cbd8fa" ON "social_posts" ("status", "scheduled_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_04da09797c99cfdb58a564cc46" ON "social_posts" ("workspace_id", "scheduled_at") `);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"contacts":null,"users":null}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"emails":0,"sms":0}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"sms": 0, "emails": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"users": null, "contacts": null}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_04da09797c99cfdb58a564cc46"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0c07cc42790f7bde7431cbd8fa"`);
        await queryRunner.query(`DROP TABLE "social_posts"`);
    }

}
