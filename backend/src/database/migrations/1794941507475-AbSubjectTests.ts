import { MigrationInterface, QueryRunner } from "typeorm";

export class AbSubjectTests1794941507475 implements MigrationInterface {
    name = 'AbSubjectTests1794941507475'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD "variant" character varying(1)`);
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "ab_test" jsonb`);
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "ab_decide_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "ab_winner" character varying(1)`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`CREATE INDEX "IDX_8b6b94352da69af03dbaf87c63" ON "campaigns" ("status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_8b6b94352da69af03dbaf87c63"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "ab_winner"`);
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "ab_decide_at"`);
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "ab_test"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "variant"`);
    }

}
