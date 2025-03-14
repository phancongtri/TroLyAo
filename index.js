require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');
const { Client } = require('pg');

// Kết nối PostgreSQL trên Railway
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
db.connect()
    .then(() => console.log('✅ Đã kết nối PostgreSQL'))
    .catch(err => console.error('❌ Lỗi kết nối PostgreSQL:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

// 📌 **Tạo bảng nếu chưa có**
async function initDB() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            task TEXT NOT NULL,
            due_time TIMESTAMP,
            repeat_interval TEXT
        )
    `);
}
initDB();

// 📌 **Thêm công việc**
bot.command('add', (ctx) => {
    ctx.reply('Nhập nội dung công việc:', Markup.forceReply());
});

bot.on('text', async (ctx) => {
    const userId = ctx.message.from.id;
    const taskText = ctx.message.text;

    await db.query('INSERT INTO tasks (user_id, task) VALUES ($1, $2)', [userId, taskText]);

    ctx.reply('✅ Công việc đã được thêm!');
});

// 📌 **Xem danh sách công việc**
bot.command('list', async (ctx) => {
    const userId = ctx.message.from.id;
    const result = await db.query('SELECT task FROM tasks WHERE user_id = $1', [userId]);

    if (result.rows.length > 0) {
        const tasks = result.rows.map(row => `- ${row.task}`).join('\n');
        ctx.reply(`📋 Danh sách công việc:\n${tasks}`);
    } else {
        ctx.reply('📭 Không có công việc nào.');
    }
});

// 📌 **Xóa công việc mới nhất**
bot.command('delete', async (ctx) => {
    const userId = ctx.message.from.id;
    const result = await db.query('DELETE FROM tasks WHERE user_id = $1 RETURNING *', [userId]);

    if (result.rowCount > 0) {
        ctx.reply('❌ Công việc cuối cùng đã bị xóa!');
    } else {
        ctx.reply('⚠️ Không có công việc nào để xóa.');
    }
});

// 📌 **Nhắc nhở công việc lúc 6h sáng hàng ngày**
schedule.scheduleJob('0 6 * * *', async () => {
    const result = await db.query('SELECT DISTINCT user_id FROM tasks');

    result.rows.forEach(async (row) => {
        const userId = row.user_id;
        const tasks = await db.query('SELECT task FROM tasks WHERE user_id = $1', [userId]);

        if (tasks.rows.length > 0) {
            const taskList = tasks.rows.map(t => `- ${t.task}`).join('\n');
            bot.telegram.sendMessage(userId, `📅 Công việc hôm nay:\n${taskList}`);
        }
    });
});

// 📌 **Nhắc nhở 15 phút trước công việc**
schedule.scheduleJob('* * * * *', async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 15);

    const result = await db.query('SELECT user_id, task FROM tasks WHERE due_time = $1', [now]);

    result.rows.forEach(row => {
        bot.telegram.sendMessage(row.user_id, `⏳ Nhắc nhở: ${row.task} sẽ diễn ra sau 15 phút!`);
    });
});

// 📌 **Khởi chạy bot**
bot.launch();
console.log('🤖 Bot đã chạy!');
