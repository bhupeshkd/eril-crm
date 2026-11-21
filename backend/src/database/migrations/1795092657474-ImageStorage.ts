import { MigrationInterface, QueryRunner } from "typeorm";

export class ImageStorage1795092657474 implements MigrationInterface {
    name = 'ImageStorage1795092657474'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "community_images" ADD "storage" character varying(10) NOT NULL DEFAULT 'db'`);
        await queryRunner.query(`ALTER TABLE "community_images" ADD "storage_key" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "community_images" ALTER COLUMN "data" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "community_images" ALTER COLUMN "data" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "community_images" DROP COLUMN "storage_key"`);
        await queryRunner.query(`ALTER TABLE "community_images" DROP COLUMN "storage"`);
    }

}
