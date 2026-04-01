import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = pkg;
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// 1. إعدادات البوت
// ========================
const BOT_INFO = {
    name: "IDLEB X STORE",
    version: "5.0",
    developer: "IDLEB X TEAM"
};

const ADMIN_PASSWORD = "idleb2024";
let activeAdminSessions = {};

// المسارات
const AUTH_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp/auth_info' : path.join(__dirname, 'auth_info');
const IMAGES_DIR = path.join(__dirname, 'product_images');
const BACKUP_DIR = path.join(__dirname, 'backups');

// إنشاء المجلدات
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const startTime = Date.now();

function getUptime() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours} ساعة ${minutes % 60} دقيقة`;
    if (minutes > 0) return `${minutes} دقيقة`;
    return `${seconds} ثانية`;
}

// ========================
// 2. نظام التخزين
// ========================
let products = {};
let orders = {};
let users = {};
let coupons = {};
let carts = {};
let backups = [];
let orderCounter = 1;

// تحميل البيانات
function loadData() {
    try {
        if (fs.existsSync('products.json')) products = JSON.parse(fs.readFileSync('products.json'));
        if (fs.existsSync('orders.json')) orders = JSON.parse(fs.readFileSync('orders.json'));
        if (fs.existsSync('users.json')) users = JSON.parse(fs.readFileSync('users.json'));
        if (fs.existsSync('coupons.json')) coupons = JSON.parse(fs.readFileSync('coupons.json'));
        if (fs.existsSync('carts.json')) carts = JSON.parse(fs.readFileSync('carts.json'));
        if (fs.existsSync('counter.json')) orderCounter = JSON.parse(fs.readFileSync('counter.json')).counter || 1;
    } catch(e) {}
}

function saveData() {
    fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
    fs.writeFileSync('orders.json', JSON.stringify(orders, null, 2));
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
    fs.writeFileSync('coupons.json', JSON.stringify(coupons, null, 2));
    fs.writeFileSync('carts.json', JSON.stringify(carts, null, 2));
    fs.writeFileSync('counter.json', JSON.stringify({ counter: orderCounter }, null, 2));
}

loadData();

// ========================
// 3. نظام المستخدمين والنقاط
// ========================
function getUser(userId, name) {
    if (!users[userId]) {
        users[userId] = {
            name: name,
            points: 0,
            level: 'برونزي',
            totalSpent: 0,
            ordersCount: 0,
            joinDate: new Date().toISOString(),
            banned: false
        };
        saveData();
    }
    return users[userId];
}

function addPoints(userId, points) {
    const user = getUser(userId, '');
    user.points += points;
    
    // تحديث المستوى حسب النقاط
    if (user.points >= 500) user.level = 'ذهبي';
    else if (user.points >= 200) user.level = 'فضي';
    else user.level = 'برونزي';
    
    saveData();
    return user.points;
}

function usePoints(userId, points) {
    const user = getUser(userId, '');
    if (user.points >= points) {
        user.points -= points;
        saveData();
        return true;
    }
    return false;
}

// ========================
// 4. نظام المنتجات
// ========================
function addProduct(name, price, description, imagePath, adminId, hasImage = true) {
    const productId = name.toLowerCase().trim();
    products[productId] = {
        id: productId,
        name: name,
        price: parseFloat(price),
        description: description,
        image: hasImage ? imagePath : null,
        hasImage: hasImage,
        stock: 10,
        sales: 0,
        rating: { total: 0, count: 0, average: 0 },
        addedBy: adminId,
        date: new Date().toISOString()
    };
    saveData();
    return true;
}

function rateProduct(productId, rating, userId) {
    const product = products[productId];
    if (!product) return false;
    
    product.rating.total += rating;
    product.rating.count++;
    product.rating.average = product.rating.total / product.rating.count;
    saveData();
    return true;
}

function getProductList() {
    const productList = Object.values(products);
    if (productList.length === 0) return null;
    
    let msg = "🛍️ *منتجاتنا* 🛍️\n\n";
    productList.forEach((p, i) => {
        const stars = '⭐'.repeat(Math.floor(p.rating.average)) + '☆'.repeat(5 - Math.floor(p.rating.average));
        msg += `${i+1}️⃣ *${p.name}*\n`;
        msg += `💰 السعر: ${p.price}$\n`;
        msg += `⭐ التقييم: ${stars} (${p.rating.count} تقييم)\n`;
        msg += `📝 ${p.description.substring(0, 50)}${p.description.length > 50 ? '...' : ''}\n\n`;
    });
    msg += `📌 *لرؤية تفاصيل:* اكتب اسم المنتج\n`;
    msg += `📌 *للطلب:* اكتب "طلب [اسم]" أو "أضف للعربة [اسم]"`;
    return msg;
}

function getProductDetails(productName) {
    const productId = productName.toLowerCase().trim();
    const product = products[productId];
    if (!product) return null;
    
    const stars = '⭐'.repeat(Math.floor(product.rating.average)) + '☆'.repeat(5 - Math.floor(product.rating.average));
    const text = `📱 *${product.name}* 📱\n\n💰 *السعر:* ${product.price}$\n⭐ *التقييم:* ${stars} (${product.rating.count} تقييم)\n📝 *الوصف:* ${product.description}\n📦 *المتوفر:* ${product.stock} قطعة\n📊 *تم بيع:* ${product.sales} قطعة`;
    
    return { text: text, image: product.hasImage ? product.image : null, hasImage: product.hasImage, product: product };
}

// ========================
// 5. نظام عربة التسوق
// ========================
function addToCart(userId, productName, quantity = 1) {
    const productId = productName.toLowerCase().trim();
    const product = products[productId];
    if (!product) return { error: "not_found" };
    if (product.stock < quantity) return { error: "out_of_stock", stock: product.stock };
    
    if (!carts[userId]) carts[userId] = { items: [], total: 0 };
    
    const existingItem = carts[userId].items.find(i => i.productId === productId);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        carts[userId].items.push({
            productId: productId,
            name: product.name,
            price: product.price,
            quantity: quantity
        });
    }
    
    carts[userId].total = carts[userId].items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    saveData();
    return { success: true, cart: carts[userId] };
}

function removeFromCart(userId, productName) {
    const productId = productName.toLowerCase().trim();
    if (!carts[userId]) return false;
    
    carts[userId].items = carts[userId].items.filter(i => i.productId !== productId);
    carts[userId].total = carts[userId].items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    if (carts[userId].items.length === 0) delete carts[userId];
    saveData();
    return true;
}

function getCart(userId) {
    const cart = carts[userId];
    if (!cart || cart.items.length === 0) return null;
    
    let msg = "🛒 *عربة التسوق* 🛒\n\n";
    cart.items.forEach((item, i) => {
        msg += `${i+1}. *${item.name}* - ${item.quantity} × ${item.price}$ = ${item.price * item.quantity}$\n`;
    });
    msg += `\n💰 *المجموع:* ${cart.total}$\n`;
    msg += `📌 *لإنهاء الطلب:* اكتب "شراء"\n`;
    msg += `📌 *لإزالة منتج:* اكتب "حذف [اسم المنتج]"`;
    return msg;
}

// ========================
// 6. نظام الطلبات
// ========================
function createOrder(userId, userName, couponCode = null) {
    const cart = carts[userId];
    if (!cart || cart.items.length === 0) return { error: "empty_cart" };
    
    let discount = 0;
    let couponUsed = null;
    
    if (couponCode && coupons[couponCode.toLowerCase()]) {
        const coupon = coupons[couponCode.toLowerCase()];
        if (!coupon.expired && coupon.usesLeft > 0) {
            discount = coupon.type === 'percentage' ? (cart.total * coupon.value / 100) : coupon.value;
            coupon.usesLeft--;
            couponUsed = couponCode;
            saveData();
        }
    }
    
    const finalTotal = cart.total - discount;
    const orderId = `ORD-${orderCounter++}`;
    
    orders[orderId] = {
        id: orderId,
        items: [...cart.items],
        customerId: userId,
        customerName: userName,
        subtotal: cart.total,
        discount: discount,
        total: finalTotal,
        couponUsed: couponUsed,
        status: "pending",
        date: new Date().toISOString(),
        tracking: "تم الاستلام"
    };
    
    // تنقيص المخزون وتحديث المبيعات
    cart.items.forEach(item => {
        const product = products[item.productId];
        if (product) {
            product.stock -= item.quantity;
            product.sales += item.quantity;
        }
    });
    
    // تحديث بيانات المستخدم
    const user = getUser(userId, userName);
    user.totalSpent += finalTotal;
    user.ordersCount++;
    addPoints(userId, Math.floor(finalTotal));
    
    delete carts[userId];
    saveData();
    
    return { success: true, orderId: orderId, order: orders[orderId] };
}

function getPendingOrders() {
    const pending = Object.values(orders).filter(o => o.status === "pending");
    if (pending.length === 0) return null;
    
    let msg = "📦 *الطلبات المعلقة* 📦\n\n";
    pending.forEach(o => {
        msg += `🆔 *${o.id}*\n`;
        msg += `👤 العميل: ${o.customerName}\n`;
        msg += `📞 رقم: ${o.customerId.split('@')[0]}\n`;
        msg += `📦 المنتجات: ${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n`;
        msg += `💰 الإجمالي: ${o.total}$\n`;
        msg += `📅 التاريخ: ${new Date(o.date).toLocaleString()}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    });
    msg += `✅ *لتأكيد:* تأكيد [رقم]\n`;
    msg += `❌ *لرفض:* رفض [رقم] [سبب]\n`;
    msg += `🚚 *لتحديث التتبع:* تتبع [رقم] [حالة]`;
    return msg;
}

function updateTracking(orderId, status) {
    const order = orders[orderId];
    if (!order) return { error: "not_found" };
    
    const statusMap = {
        'تحضير': 'جاري تحضير الطلب',
        'شحن': 'تم شحن الطلب',
        'تسليم': 'تم تسليم الطلب'
    };
    
    order.tracking = statusMap[status] || status;
    saveData();
    return { success: true, order: order };
}

function confirmOrder(orderId) {
    const order = orders[orderId];
    if (!order) return { error: "not_found" };
    if (order.status !== "pending") return { error: "already_processed" };
    
    order.status = "confirmed";
    saveData();
    return { success: true, order: order };
}

function rejectOrder(orderId, reason) {
    const order = orders[orderId];
    if (!order) return { error: "not_found" };
    if (order.status !== "pending") return { error: "already_processed" };
    
    order.status = "rejected";
    order.rejectReason = reason || "لم يتم تحديد سبب";
    saveData();
    return { success: true, order: order };
}

function getCustomerOrders(userId) {
    const userOrders = Object.values(orders).filter(o => o.customerId === userId);
    if (userOrders.length === 0) return null;
    
    let msg = "📋 *طلباتي* 📋\n\n";
    userOrders.forEach(o => {
        const statusEmoji = o.status === 'pending' ? '⏳' : (o.status === 'confirmed' ? '✅' : '❌');
        msg += `${statusEmoji} *${o.id}* - ${new Date(o.date).toLocaleDateString()}\n`;
        msg += `   📦 ${o.items.length} منتج - ${o.total}$\n`;
        msg += `   🚚 حالة التوصيل: ${o.tracking}\n`;
    });
    return msg;
}

// ========================
// 7. نظام كوبونات الخصم
// ========================
function createCoupon(code, type, value, maxUses = 1) {
    coupons[code.toLowerCase()] = {
        code: code,
        type: type, // 'percentage' or 'fixed'
        value: parseFloat(value),
        usesLeft: maxUses,
        expired: false,
        createdAt: new Date().toISOString()
    };
    saveData();
    return true;
}

function getCouponsList() {
    const couponList = Object.values(coupons);
    if (couponList.length === 0) return null;
    
    let msg = "🎫 *الكوبونات المتاحة* 🎫\n\n";
    couponList.forEach(c => {
        msg += `📌 *${c.code}*\n`;
        msg += `   ${c.type === 'percentage' ? `${c.value}% خصم` : `${c.value}$ خصم`}\n`;
        msg += `   📊 متبقي: ${c.usesLeft} استخدام\n`;
    });
    return msg;
}

// ========================
// 8. نظام النسخ الاحتياطي
// ========================
function createBackup() {
    const backup = {
        id: `BACKUP-${Date.now()}`,
        date: new Date().toISOString(),
        products: products,
        orders: orders,
        users: users,
        coupons: coupons
    };
    
    backups.push(backup);
    const backupPath = path.join(BACKUP_DIR, `backup_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    if (backups.length > 10) backups.shift();
    return backup;
}

function restoreBackup(backupId) {
    const backup = backups.find(b => b.id === backupId);
    if (!backup) return false;
    
    products = backup.products;
    orders = backup.orders;
    users = backup.users;
    coupons = backup.coupons;
    saveData();
    return true;
}

// ========================
// 9. نظام التحليلات
// ========================
function getAnalytics() {
    const productCount = Object.keys(products).length;
    const pendingOrders = Object.values(orders).filter(o => o.status === 'pending').length;
    const totalOrders = Object.values(orders).length;
    const totalSales = Object.values(orders).filter(o => o.status === 'confirmed').reduce((sum, o) => sum + o.total, 0);
    const totalUsers = Object.keys(users).length;
    
    // أكثر المنتجات مبيعاً
    const topProducts = Object.values(products)
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 3);
    
    let msg = `📊 *إحصائيات المتجر* 📊\n\n`;
    msg += `📦 المنتجات: ${productCount}\n`;
    msg += `👥 العملاء: ${totalUsers}\n`;
    msg += `⏳ طلبات معلقة: ${pendingOrders}\n`;
    msg += `✅ إجمالي الطلبات: ${totalOrders}\n`;
    msg += `💰 إجمالي المبيعات: ${totalSales}$\n`;
    msg += `⭐ متوسط التقييم: ${(Object.values(products).reduce((sum, p) => sum + p.rating.average, 0) / productCount || 0).toFixed(1)}/5\n\n`;
    
    if (topProducts.length > 0) {
        msg += `🏆 *الأكثر مبيعاً* 🏆\n`;
        topProducts.forEach((p, i) => {
            msg += `${i+1}. ${p.name} - ${p.sales} قطعة\n`;
        });
    }
    
    return msg;
}

// ========================
// 10. نظام الحماية
// ========================
let bannedUsers = [];
let messageCount = {};

function isBanned(userId) {
    return bannedUsers.includes(userId);
}

function banUser(userId) {
    if (!bannedUsers.includes(userId)) {
        bannedUsers.push(userId);
        saveData();
        return true;
    }
    return false;
}

function unbanUser(userId) {
    const index = bannedUsers.indexOf(userId);
    if (index !== -1) {
        bannedUsers.splice(index, 1);
        saveData();
        return true;
    }
    return false;
}

function checkSpam(userId) {
    const now = Date.now();
    if (!messageCount[userId]) messageCount[userId] = [];
    messageCount[userId] = messageCount[userId].filter(t => now - t < 5000);
    
    if (messageCount[userId].length >= 5) {
        banUser(userId);
        return true;
    }
    messageCount[userId].push(now);
    return false;
}

// ========================
// 11. لوحة التحكم
// ========================
function isAdminActive(userId) {
    const session = activeAdminSessions[userId];
    if (!session) return false;
    if (Date.now() - session.startTime > 30 * 60 * 1000) {
        delete activeAdminSessions[userId];
        return false;
    }
    return true;
}

function startAdminSession(userId, password) {
    if (password !== ADMIN_PASSWORD) return false;
    activeAdminSessions[userId] = { startTime: Date.now() };
    return true;
}

function getAdminHelp() {
    return `🔐 *لوحة تحكم المشرف* 🔐

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 *المنتجات*
• اضافة منتج - إضافة منتج جديد
• منتجات - عرض المنتجات
• تعديل سعر [اسم] [سعر] - تعديل السعر
• حذف منتج [اسم] - حذف منتج

🎫 *الكوبونات*
• كوبون [كود] [نسبة/ثابت] [قيمة] - إنشاء كوبون
• كوبونات - عرض الكوبونات

📋 *الطلبات*
• طلبات - عرض الطلبات المعلقة
• تأكيد [رقم] - تأكيد طلب
• رفض [رقم] [سبب] - رفض طلب
• تتبع [رقم] [حالة] - تحديث حالة التوصيل

👥 *العملاء*
• عميل [رقم] - معلومات العميل
• نقاط [رقم] [نقاط] - إضافة نقاط
• حظر [رقم] - حظر مستخدم

💾 *النسخ الاحتياطي*
• نسخ احتياطي - إنشاء نسخة
• استعادة [معرف] - استعادة نسخة

📊 *إحصائيات*
• احصائيات - عرض الإحصائيات

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ الجلسة تنتهي بعد 30 دقيقة`;
}

// ========================
// 12. ردود العملاء
// ========================
function understandIntent(message, userName) {
    const msg = message.toLowerCase().trim();
    
    if (msg.includes('عرض') || msg.includes('منتجات') || msg === 'عرض') return { intent: 'show_products' };
    if (msg.includes('عربة') || msg === 'عربة') return { intent: 'show_cart' };
    if (msg === 'شراء' || msg === 'اطلب') return { intent: 'checkout' };
    if (msg.startsWith('أضف للعربة') || msg.startsWith('اضف للعربة')) {
        let product = msg.replace(/أضف للعربة|اضف للعربة|من|:/g, '').trim();
        return { intent: 'add_to_cart', product: product };
    }
    if (msg.startsWith('حذف من العربة') || msg.startsWith('حذف')) {
        let product = msg.replace(/حذف من العربة|حذف|من|:/g, '').trim();
        return { intent: 'remove_from_cart', product: product };
    }
    if (msg.startsWith('طلب') || msg.startsWith('بدي')) {
        let product = msg.replace(/طلب|بدي|ابي|اشتري|من|:/g, '').trim();
        return { intent: 'order_product', product: product };
    }
    if (msg.startsWith('كوبون')) {
        let code = msg.replace(/كوبون|:/g, '').trim();
        return { intent: 'apply_coupon', code: code };
    }
    if (msg.includes('تقييم')) {
        let match = msg.match(/تقييم\s+(\S+)\s+(\d+)/);
        if (match) return { intent: 'rate_product', product: match[1], rating: parseInt(match[2]) };
    }
    if (msg.includes('طلباتي')) return { intent: 'my_orders' };
    if (msg.includes('نقاطي')) return { intent: 'my_points' };
    if (msg.includes('بروفايلي') || msg.includes('بروفايل')) return { intent: 'my_profile' };
    if (msg.includes('تتبع')) {
        let orderId = msg.replace(/تتبع|:/g, '').trim().toUpperCase();
        return { intent: 'track_order', orderId: orderId };
    }
    
    for (const productId in products) {
        if (msg.includes(productId.toLowerCase())) {
            return { intent: 'product_details', product: productId };
        }
    }
    
    if (msg.includes('شكر') || msg.includes('تسلم')) return { intent: 'thank_you' };
    if (msg.includes('سلام') || msg.includes('مرحب') || msg.includes('هلا')) return { intent: 'greeting' };
    
    return { intent: 'unknown' };
}

async function generateReply(intent, data, userId, userName, sock) {
    const user = getUser(userId, userName);
    
    if (user.banned) return "🚫 *تم حظرك من البوت*\nللتواصل مع المشرف: تواصل مع الدعم.";
    
    switch(intent) {
        case 'show_products':
            const list = getProductList();
            return list || "📭 لا توجد منتجات حالياً.";
            
        case 'product_details':
            const details = getProductDetails(data.product);
            if (!details) return `🚫 منتج "${data.product}" غير موجود.`;
            if (details.hasImage && details.image && fs.existsSync(details.image)) {
                const imageBuffer = fs.readFileSync(details.image);
                await sock.sendMessage(userId, { image: imageBuffer, caption: details.text });
                return null;
            }
            return details.text;
            
        case 'add_to_cart':
            const addResult = addToCart(userId, data.product, 1);
            if (addResult.error === 'not_found') return `🚫 منتج "${data.product}" غير موجود.`;
            if (addResult.error === 'out_of_stock') return `🚫 آسف، منتج "${data.product}" نفد من المخزون.`;
            return `✅ تم إضافة *${products[data.product.toLowerCase()]?.name || data.product}* إلى عربتك!\n📌 اكتب "عربة" لرؤية عربتك`;
            
        case 'show_cart':
            const cart = getCart(userId);
            return cart || "🛒 عربتك فارغة.\n📌 أضف منتجات: أضف للعربة [اسم المنتج]";
            
        case 'remove_from_cart':
            if (removeFromCart(userId, data.product)) return `✅ تم إزالة المنتج من عربتك.`;
            return `❌ المنتج غير موجود في عربتك.`;
            
        case 'checkout':
            const orderResult = createOrder(userId, userName);
            if (orderResult.error === 'empty_cart') return "🛒 عربتك فارغة! أضف منتجات أولاً.";
            
            for (const adminId in activeAdminSessions) {
                const adminMsg = `📦 *طلب جديد* 📦\n\n🆔 *رقم:* ${orderResult.orderId}\n👤 *العميل:* ${userName}\n💰 *الإجمالي:* ${orderResult.order.total}$\n✅ *تأكيد:* تأكيد ${orderResult.orderId}`;
                await sock.sendMessage(adminId, { text: adminMsg });
            }
            
            return `✅ *تم استلام طلبك!* ✅\n\n🆔 رقم الطلب: ${orderResult.orderId}\n💰 الإجمالي: ${orderResult.order.total}$\n🔔 سيتم التواصل معك قريباً.\n🎁 حصلت على ${Math.floor(orderResult.order.total)} نقطة ولاء!`;
            
        case 'apply_coupon':
            if (coupons[data.code]) {
                return `✅ كوبون *${data.code}* فعال! اكتب "شراء" لإنهاء الطلب مع الخصم.`;
            }
            return `❌ كوبون غير صالح أو منتهي الصلاحية.`;
            
        case 'rate_product':
            if (rateProduct(data.product, data.rating, userId)) return `⭐ شكراً لتقييمك! تم إضافة ${data.rating} نجوم للمنتج.`;
            return `❌ المنتج غير موجود.`;
            
        case 'my_orders':
            const ordersMsg = getCustomerOrders(userId);
            return ordersMsg || "📭 لا يوجد لديك طلبات سابقة.";
            
        case 'my_points':
            return `⭐ *نقاط الولاء* ⭐\n\n💰 نقاطك: ${user.points}\n🏆 مستواك: ${user.level}\n📊 إجمالي المشتريات: ${user.totalSpent}$\n🛍️ عدد الطلبات: ${user.ordersCount}\n\n🎁 كل 1$ = 1 نقطة. 200 نقطة = مستوى فضي، 500 = ذهبي!`;
            
        case 'my_profile':
            return `👤 *بروفايلك* 👤\n\n📛 الاسم: ${user.name}\n💰 نقاط الولاء: ${user.points}\n🏆 المستوى: ${user.level}\n📊 إجمالي المشتريات: ${user.totalSpent}$\n🛍️ عدد الطلبات: ${user.ordersCount}\n📅 عضو منذ: ${new Date(user.joinDate).toLocaleDateString()}`;
            
        case 'track_order':
            const order = orders[data.orderId];
            if (!order) return `❌ طلب رقم ${data.orderId} غير موجود.`;
            const statusMap = { pending: '⏳ قيد المراجعة', confirmed: '✅ تم التأكيد', rejected: '❌ مرفوض' };
            return `🚚 *تتبع الطلب* 🚚\n\n🆔 *رقم:* ${order.id}\n📦 *المنتجات:* ${order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n💰 *الإجمالي:* ${order.total}$\n📌 *الحالة:* ${statusMap[order.status] || order.status}\n🚛 *التوصيل:* ${order.tracking}`;
            
        case 'thank_you':
            return `العفو! الله يسلمك 🫡\n📌 إذا حابب تشوف منتجاتنا: "عرض المنتجات"`;
            
        case 'greeting':
            const productCount = Object.keys(products).length;
            return `وعليكم السلام ورحمة الله! 👋\n\nأهلاً بك في المتجر. عندنا ${productCount} منتج متوفر.\n🎁 نقاط ولاء لكل عملية شراء!\n\n📌 *الأوامر:*\n• عرض المنتجات\n• أضف للعربة [اسم]\n• عربة\n• شراء\n• نقاطي\n• بروفايلي`;
            
        default:
            return `🤔 عذراً، ما فهمت.\n\n📌 *الأوامر المتاحة:*\n• عرض المنتجات\n• أضف للعربة [اسم]\n• عربة\n• شراء\n• نقاطي\n• بروفايلي\n• طلباتي`;
    }
}

// ========================
// 13. أوامر المشرف
// ========================
async function handleAdminCommands(message, userId, userName, sock) {
    const msg = message.toLowerCase().trim();
    
    if (msg === 'فتح اللوحة') return `🔐 كلمة السر:`;
    if (msg.startsWith('كلمة السر')) {
        const password = message.replace(/كلمة السر/gi, '').trim();
        if (startAdminSession(userId, password)) return `🔓 *تم فتح لوحة التحكم!*\n\n📋 اكتب "مساعدة"`;
        return `🔒 كلمة السر خطأ!`;
    }
    
    if (!isAdminActive(userId)) return null;
    
    if (msg === 'مساعدة') return getAdminHelp();
    
    // إدارة المنتجات
    if (msg === 'اضافة منتج') {
        pendingProduct[userId] = { step: 'name' };
        return `📝 اسم المنتج:`;
    }
    
    if (pendingProduct[userId]) {
        const state = pendingProduct[userId];
        if (state.step === 'name') { state.name = message; state.step = 'price'; return `💰 السعر: (رقم)`;
        } else if (state.step === 'price') {
            const price = parseFloat(message);
            if (isNaN(price)) return `❌ رقم غير صحيح`;
            state.price = price; state.step = 'description'; return `📝 الوصف:`;
        } else if (state.step === 'description') {
            state.description = message; state.step = 'image'; return `🖼️ أرسل الصورة أو "بدون صورة"`;
        } else if (state.step === 'image') {
            if (msg === 'بدون صورة') {
                addProduct(state.name, state.price, state.description, null, userId, false);
                delete pendingProduct[userId];
                return `✅ تم إضافة ${state.name} بنجاح!`;
            }
        }
    }
    
    if (msg.startsWith('تعديل سعر')) {
        const parts = message.split(' ');
        const productName = parts[2];
        const newPrice = parseFloat(parts[3]);
        const product = products[productName?.toLowerCase()];
        if (product) { product.price = newPrice; saveData(); return `✅ تم تعديل سعر ${product.name} إلى ${newPrice}$`; }
        return `❌ منتج غير موجود`;
    }
    
    if (msg.startsWith('حذف منتج')) {
        const productName = message.replace(/حذف منتج/gi, '').trim();
        if (products[productName.toLowerCase()]) {
            delete products[productName.toLowerCase()];
            saveData();
            return `✅ تم حذف المنتج`;
        }
        return `❌ منتج غير موجود`;
    }
    
    // الكوبونات
    if (msg.startsWith('كوبون')) {
        const parts = message.split(' ');
        const code = parts[1];
        const type = parts[2];
        const value = parseFloat(parts[3]);
        if (createCoupon(code, type === 'نسبة' ? 'percentage' : 'fixed', value)) {
            return `✅ تم إنشاء كوبون ${code} بقيمة ${value}${type === 'نسبة' ? '%' : '$'}`;
        }
    }
    
    if (msg === 'كوبونات') return getCouponsList() || "لا توجد كوبونات";
    
    // الطلبات
    if (msg === 'طلبات') return getPendingOrders() || "📭 لا توجد طلبات";
    
    if (msg.startsWith('تأكيد')) {
        const orderId = msg.replace('تأكيد', '').trim().toUpperCase();
        const result = confirmOrder(orderId);
        if (result.success) {
            const customerMsg = `✅ *تم تأكيد طلبك* ✅\n\n🆔 ${orderId}\nسيتم تجهيز الطلب قريباً.`;
            await sock.sendMessage(result.order.customerId, { text: customerMsg });
            return `✅ تم تأكيد ${orderId}`;
        }
        return `❌ طلب غير موجود`;
    }
    
    if (msg.startsWith('رفض')) {
        const parts = message.split(' ');
        const orderId = parts[1]?.toUpperCase();
        const reason = parts.slice(2).join(' ');
        const result = rejectOrder(orderId, reason);
        if (result.success) {
            const customerMsg = `❌ *تم رفض طلبك* ❌\n\n🆔 ${orderId}\n📝 السبب: ${reason}`;
            await sock.sendMessage(result.order.customerId, { text: customerMsg });
            return `❌ تم رفض ${orderId}`;
        }
        return `❌ طلب غير موجود`;
    }
    
    if (msg.startsWith('تتبع')) {
        const parts = message.split(' ');
        const orderId = parts[1]?.toUpperCase();
        const status = parts.slice(2).join(' ');
        const result = updateTracking(orderId, status);
        if (result.success) {
            const customerMsg = `🚚 *تحديث الطلب* 🚚\n\n🆔 ${orderId}\n📌 الحالة: ${result.order.tracking}`;
            await sock.sendMessage(result.order.customerId, { text: customerMsg });
            return `✅ تم تحديث تتبع ${orderId}`;
        }
        return `❌ طلب غير موجود`;
    }
    
    // العملاء
    if (msg.startsWith('عميل')) {
        const customerNumber = message.replace(/عميل/gi, '').trim();
        const customerId = customerNumber + '@s.whatsapp.net';
        const user = users[customerId];
        if (user) return `👤 *العميل:* ${user.name}\n💰 نقاط: ${user.points}\n🏆 المستوى: ${user.level}\n📊 مشتريات: ${user.totalSpent}$\n🛍️ طلبات: ${user.ordersCount}`;
        return `❌ عميل غير موجود`;
    }
    
    if (msg.startsWith('نقاط')) {
        const parts = message.split(' ');
        const customerNumber = parts[1];
        const points = parseInt(parts[2]);
        const customerId = customerNumber + '@s.whatsapp.net';
        if (addPoints(customerId, points)) return `✅ تم إضافة ${points} نقطة للعميل`;
        return `❌ عميل غير موجود`;
    }
    
    if (msg.startsWith('حظر')) {
        const customerNumber = message.replace(/حظر/gi, '').trim();
        const customerId = customerNumber + '@s.whatsapp.net';
        if (banUser(customerId)) return `✅ تم حظر العميل`;
        return `❌ العميل محظور بالفعل`;
    }
    
    // النسخ الاحتياطي
    if (msg === 'نسخ احتياطي') {
        const backup = createBackup();
        return `✅ تم إنشاء نسخة احتياطية: ${backup.id}`;
    }
    
    if (msg.startsWith('استعادة')) {
        const backupId = message.replace(/استعادة/gi, '').trim();
        if (restoreBackup(backupId)) return `✅ تم استعادة النسخة ${backupId}`;
        return `❌ نسخة غير موجودة`;
    }
    
    // إحصائيات
    if (msg === 'احصائيات') return getAnalytics();
    
    return null;
}

// ========================
// 14. تشغيل البوت
// ========================
let pendingProduct = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['IDLEB X STORE', 'Chrome', '5.0'],
        syncFullHistory: false,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log('\n🔐 امسح رمز QR:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('\n╔════════════════════════════════════════╗');
            console.log('║   🏪 IDLEB X STORE ULTIMATE v5.0    ║');
            console.log('║   نظام متجر متكامل بكل الميزات       ║');
            console.log('╚════════════════════════════════════════╝\n');
            console.log(`✅ البوت شغال!`);
            console.log(`⏱️ وقت التشغيل: ${getUptime()}`);
            console.log(`🔐 كلمة السر: ${ADMIN_PASSWORD}\n`);
            console.log('📌 للعملاء: "عرض المنتجات"');
            console.log('📌 للمشرف: "فتح اللوحة"\n');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const isGroup = sender.endsWith('@g.us');
        let messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        const pushName = msg.pushName || 'عميل';
        const userId = msg.key.participant || sender;
        
        // منع السبام
        if (checkSpam(userId)) return "🚫 تم حظرك بسبب الإزعاج";
        
        // معالجة الصور للمشرف
        if (msg.message.imageMessage && pendingProduct[userId] && pendingProduct[userId].step === 'image') {
            try {
                const stream = await sock.downloadMediaMessage(msg);
                const fileName = `${Date.now()}_${pendingProduct[userId].name.replace(/[^a-z0-9]/gi, '_')}.jpg`;
                const filePath = path.join(IMAGES_DIR, fileName);
                const writeStream = fs.createWriteStream(filePath);
                stream.pipe(writeStream);
                await new Promise((resolve, reject) => { writeStream.on('finish', resolve); writeStream.on('error', reject); });
                const data = pendingProduct[userId];
                addProduct(data.name, data.price, data.description, filePath, userId, true);
                delete pendingProduct[userId];
                await sock.sendMessage(sender, { text: `✅ تم إضافة ${data.name} بنجاح مع الصورة!` });
                return;
            } catch(e) { console.log(e); }
        }
        
        // المجموعات
        if (isGroup) {
            const botNumber = sock.user.id.split(':')[0];
            let shouldReply = false;
            if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botNumber + '@s.whatsapp.net')) shouldReply = true;
            if (msg.message.extendedTextMessage?.contextInfo?.participant === botNumber + '@s.whatsapp.net') shouldReply = true;
            if (messageText.includes('@') && messageText.toLowerCase().includes('idleb')) shouldReply = true;
            if (!shouldReply) return;
            
            let cleanText = messageText.replace(/@IDLEB[_X\s]+/gi, '').replace(/@\d+/g, '').trim();
            if (!cleanText) return;
            const intent = understandIntent(cleanText, pushName);
            const reply = await generateReply(intent.intent, intent, userId, pushName, sock);
            if (reply) await sock.sendMessage(sender, { text: reply });
            return;
        }
        
        // الخاص - أوامر المشرف
        const adminReply = await handleAdminCommands(messageText, userId, pushName, sock);
        if (adminReply) { await sock.sendMessage(sender, { text: adminReply }); return; }
        
        // الخاص - العملاء
        const intent = understandIntent(messageText, pushName);
        const reply = await generateReply(intent.intent, intent, userId, pushName, sock);
        if (reply) await sock.sendMessage(sender, { text: reply });
    });
}

startBot().catch(console.error);
