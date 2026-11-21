/**
 * Moves community images stored in the database into S3 (one-off, safe to re-run).
 *   cd backend && npm run images:to-s3                     (all workspaces)
 *   cd backend && npm run images:to-s3 -- --workspace <id>  (one workspace)
 * Needs the S3_* settings in backend/.env. Set IMAGE_STORAGE=s3 too so new uploads go to S3.
 */
process.env.DISABLE_SCHEDULERS = 'true';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CommunityImagesService } from '../communities/community-images';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const svc = app.get(CommunityImagesService);
    const i = process.argv.indexOf('--workspace');
    const workspaceId = i > -1 ? process.argv[i + 1] : undefined;
    if (i > -1 && !/^[0-9a-f-]{36}$/i.test(workspaceId ?? '')) throw new Error('--workspace needs a workspace id');
    let total = 0;
    for (;;) {
      const { moved, remaining } = await svc.moveToS3(50, workspaceId);
      total += moved;
      console.log(`Moved ${total} image(s); ${remaining} left in the database`);
      if (!moved || !remaining) break;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
