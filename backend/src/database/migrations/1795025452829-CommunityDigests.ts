import { MigrationInterface, QueryRunner } from "typeorm";

export class CommunityDigests1795025452829 implements MigrationInterface {
    name = 'CommunityDigests1795025452829'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "communities" ADD "digest_frequency" character varying(10) NOT NULL DEFAULT 'weekly'`);
        await queryRunner.query(`ALTER TABLE "communities" ADD "digest_hour" integer NOT NULL DEFAULT '9'`);
        await queryRunner.query(`ALTER TABLE "communities" ADD "digest_weekday" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "communities" ADD "timezone" character varying(64) NOT NULL DEFAULT 'UTC'`);
        await queryRunner.query(`ALTER TABLE "community_members" ADD "digest" character varying(10) NOT NULL DEFAULT 'community'`);
        await queryRunner.query(`ALTER TABLE "community_members" ADD "last_digest_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "community_members" DROP COLUMN "last_digest_at"`);
        await queryRunner.query(`ALTER TABLE "community_members" DROP COLUMN "digest"`);
        await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN "timezone"`);
        await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN "digest_weekday"`);
        await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN "digest_hour"`);
        await queryRunner.query(`ALTER TABLE "communities" DROP COLUMN "digest_frequency"`);
    }

}
