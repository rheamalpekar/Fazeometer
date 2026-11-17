/**
 * Promotes an existing account to a streamer and links it to a streamer channel.
 * Usage: npm run make-streamer -- someone@example.com "Channel Display Name"
 * The channel must already exist in the streamers table. This is the only way a production account becomes a streamer.
 */
import { connectAll, pool, q } from "../src/db.js";

const [email, channel] = process.argv.slice(2);
if (!email || !channel) {
  console.error('Usage: npm run make-streamer -- email@example.com "Channel Display Name"');
  process.exit(1);
}

await connectAll();
const st = (await q(`SELECT id FROM streamers WHERE display_name = $1`, [channel])).rows[0];
if (!st) { console.error(`No streamer channel named "${channel}"`); process.exit(1); }
const r = await q(`UPDATE users SET role='streamer', streamer_id=$2 WHERE email=lower($1) RETURNING id`, [email, st.id]);
if (!r.rowCount) { console.error(`No account with email ${email}. They must sign up first.`); process.exit(1); }
console.log(`${email} is now a streamer for ${channel}`);
await pool.end();
process.exit(0);
