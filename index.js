require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');
const { Client } = require('pg');

// Kết nối PostgreSQL trên Railway
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
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
    ctx.reply('✏ Nhập nội dung công việc:', Markup.forceReply());
});

bot.on('text', async (ctx) => {
    if (ctx.message.reply_to_message && ctx.message.reply_to_message.text.includes('Nhập nội dung công việc')) {
        const userId = ctx.message.from.id;
        const taskText = ctx.message.text;

        await db.query('INSERT INTO tasks (user_id, task) VALUES ($1, $2)', [userId, taskText]);

        ctx.reply('✅ Công việc đã được thêm!');
    }
});

// 📌 **Hiển thị danh sách công việc với Inline Keyboard**
bot.command('list', async (ctx) => {
    const userId = ctx.message.from.id;
    const result = await db.query('SELECT id, task FROM tasks WHERE user_id = $1', [userId]);

    if (result.rows.length > 0) {
        result.rows.forEach(row => {
            ctx.reply(
                `📌 ${row.task}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('✏ Chỉnh sửa', `edit_${row.id}`)],
                    [Markup.button.callback('❌ Xóa', `delete_${row.id}`)],
                    [Markup.button.callback('🔄 Lặp lại', `repeat_${row.id}`)]
                ])
            );
        });
    } else {
        ctx.reply('📭 Không có công việc nào.');
    }
});

// 📌 **Xóa công việc**
bot.action(/^delete_(\d+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    await db.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    ctx.reply('✅ Công việc đã được xóa!');
});

// 📌 **Chỉnh sửa công việc**
bot.action(/^edit_(\d+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    ctx.reply('✏ Nhập nội dung mới cho công việc:', Markup.forceReply());

    bot.on('text', async (ctx) => {
        if (ctx.message.reply_to_message && ctx.message.reply_to_message.text.includes('Nhập nội dung mới')) {
            const newTask = ctx.message.text;
            await db.query('UPDATE tasks SET task = $1 WHERE id = $2', [newTask, taskId]);
            ctx.reply('✅ Công việc đã được cập nhật!');
        }
    });
});

// 📌 **Đặt công việc lặp lại**
bot.action(/^repeat_(\d+)$/, async (ctx) => {
    const taskId = ctx.match[1];

    ctx.reply(
        '🔄 Chọn tần suất lặp lại:',
        Markup.inlineKeyboard([
            [Markup.button.callback('📅 Hàng ngày', `repeat_daily_${taskId}`)],
            [Markup.button.callback('📆 Hàng tuần', `repeat_weekly_${taskId}`)],
            [Markup.button.callback('📅 Hàng tháng', `repeat_monthly_${taskId}`)]
        ])
    );
});

bot.action(/^repeat_(daily|weekly|monthly)_(\d+)$/, async (ctx) => {
    const repeatType = ctx.match[1];
    const taskId = ctx.match[2];

    await db.query('UPDATE tasks SET repeat_interval = $1 WHERE id = $2', [repeatType, taskId]);
    ctx.reply(`✅ Công việc sẽ lặp lại ${repeatType}!`);
});

// 📌 **Nhắc nhở công việc lúc 6h sáng hàng ngày**
schedule.scheduleJob('0 6 * * *', async () => {
    const now = new Date();
    const day = now.getDay(); // 0 = Chủ nhật, 1 = Thứ Hai, ..., 6 = Thứ Bảy
    const date = now.getDate();

    const result = await db.query('SELECT user_id, task, repeat_interval FROM tasks');

    result.rows.forEach(row => {
        let sendReminder = false;

        if (row.repeat_interval === 'daily') {
            sendReminder = true;
        } else if (row.repeat_interval === 'weekly' && day === 1) { // Nhắc vào Thứ Hai
            sendReminder = true;
        } else if (row.repeat_interval === 'monthly' && date === 1) { // Nhắc vào ngày 1 hàng tháng
            sendReminder = true;
        }

        if (sendReminder) {
            bot.telegram.sendMessage(row.user_id, `🔄 Nhắc nhở công việc lặp lại: ${row.task}`);
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
