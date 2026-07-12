import express from 'express';
import {
  context,
  createServer,
  getServerPort,
  reddit,
  redis,
} from '@devvit/web/server';

const app = express();
app.use(express.json());

const router = express.Router();

/** Sorted set holding every player's best score. */
const LEADERBOARD_KEY = 'splash-siege:leaderboard';

/** Daily challenge boards: one sorted set per UTC date, self-expiring. */
const dayKey = (): string => new Date().toISOString().slice(0, 10);
const dailyKey = (d: string): string => `splash-siege:daily:${d}`;
const DAILY_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Returns the current player's name and personal best. */
router.get('/api/init', async (_req, res): Promise<void> => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const best = (await redis.zScore(LEADERBOARD_KEY, username)) ?? 0;
    res.json({ username, best });
  } catch {
    res.json({ username: 'anonymous', best: 0 });
  }
});

/** Records a finished run. Only stores it if it beats the player's best. */
router.post('/api/score', async (req, res): Promise<void> => {
  try {
    const score = Math.max(0, Math.floor(Number(req.body?.score ?? 0)));
    const mode = req.body?.mode === 'daily' ? 'daily' : 'classic';
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const previous = (await redis.zScore(LEADERBOARD_KEY, username)) ?? 0;
    if (score > previous) {
      await redis.zAdd(LEADERBOARD_KEY, { member: username, score });
    }
    if (mode === 'daily' && username !== 'anonymous') {
      // Server decides the date — clients can't post to old boards.
      const key = dailyKey(dayKey());
      const prevDaily = (await redis.zScore(key, username)) ?? 0;
      if (score > prevDaily) {
        await redis.zAdd(key, { member: username, score });
        await redis.expire(key, DAILY_TTL_SECONDS); // boards clean themselves up
      }
    }
    res.json({ best: Math.max(previous, score) });
  } catch {
    res.status(500).json({ error: 'could not save score' });
  }
});

/** Top five players — all-time, or today's board with the caller's rank. */
router.get('/api/leaderboard', async (req, res): Promise<void> => {
  try {
    const isDaily = req.query?.mode === 'daily';
    const key = isDaily ? dailyKey(dayKey()) : LEADERBOARD_KEY;
    const top = await redis.zRange(key, 0, 4, { by: 'rank', reverse: true });
    let rank: number | undefined;
    let players: number | undefined;
    if (isDaily) {
      players = await redis.zCard(key);
      const username = (await reddit.getCurrentUsername()) ?? '';
      if (username && players) {
        const asc = await redis.zRank(key, username); // 0-based, ascending
        if (asc !== undefined) rank = players - asc;  // → 1-based, descending
      }
    }
    res.json({ top, rank, players });
  } catch {
    res.json({ top: [] });
  }
});

/** Shared helper: creates a Splash Siege post in the current subreddit. */
async function createGamePost() {
  const subredditName = context.subredditName;
  if (!subredditName) throw new Error('subredditName missing from context');
  return await reddit.submitCustomPost({
    subredditName,
    title: 'Splash Siege — shoot the water balloons before the garden reaches the sky!',
    textFallback: {
      text: 'Splash Siege is an interactive game post. Open it on new Reddit or the app to play!',
    },
  });
}

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createGamePost();
    res.json({ status: 'success', message: `Created post ${post.id}` });
  } catch (err) {
    console.error('on-app-install failed', err);
    res.status(400).json({ status: 'error', message: 'post creation failed' });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createGamePost();
    res.json({ navigateTo: post.url, showToast: 'Splash Siege post created!' });
  } catch (err) {
    console.error('menu post-create failed', err);
    res.status(400).json({ showToast: 'Could not create the post.' });
  }
});

app.use(router);

const server = createServer(app);
server.on('error', (err) => console.error(`server error: ${err.stack}`));
server.listen(getServerPort());
