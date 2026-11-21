import { MigrationInterface, QueryRunner } from "typeorm";

export class CommunityMentions1795066892329 implements MigrationInterface {
    name = 'CommunityMentions1795066892329'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "community_mentions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "community_id" uuid NOT NULL, "member_id" uuid NOT NULL, "by_member_id" uuid, "by_user_id" uuid, "post_id" uuid NOT NULL, "comment_id" uuid, "read_at" TIMESTAMP WITH TIME ZONE, "emailed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_adb2a9a9a0509b03d1a4f4a2a9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d3bc6e7f630697ec2cb1e1d300" ON "community_mentions" ("by_member_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_599799eff352d7c7248fd97c64" ON "community_mentions" ("member_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "community_members" ADD "mention_emails" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "community_posts" ADD "mentions" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "community_comments" ADD "mentions" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "community_comments" DROP COLUMN "mentions"`);
        await queryRunner.query(`ALTER TABLE "community_posts" DROP COLUMN "mentions"`);
        await queryRunner.query(`ALTER TABLE "community_members" DROP COLUMN "mention_emails"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_599799eff352d7c7248fd97c64"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3bc6e7f630697ec2cb1e1d300"`);
        await queryRunner.query(`DROP TABLE "community_mentions"`);
    }

}
