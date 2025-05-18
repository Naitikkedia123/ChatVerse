const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local');

const User = require('./models/user');
const Chat = require('./models/chat');
const { isLoggedIn } = require('./middleware');
const GroupMessage = require('./models/groupMessage');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const Group = require('./models/group');
// Store online users with their socket IDs
const onlineUsers = new Map();

// MongoDB connection
async function main() {
    await mongoose.connect('mongodb+srv://kedianaitik2:naitik123@cluster0.8gfvbxl.mongodb.net/');
    console.log('Connected to MongoDB');
}
main().catch(err => console.error(err));

// Middleware
app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/uploads', express.static('uploads')); // Serve uploaded images
// Session store
const store = MongoStore.create({
    mongoUrl: 'mongodb+srv://kedianaitik2:naitik123@cluster0.8gfvbxl.mongodb.net/',
    crypto: { secret: 'your-secret-key' },
    touchAfter: 24 * 3600
});


const sessionOptions = {
    store,
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        httpOnly: true
    }
};

app.use(session(sessionOptions));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Global user
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    next();
});

// Routes
app.get('/', (req, res) => {
    res.send('Welcome to ChatVerse!');
});

// Route to show users
app.get('/users', isLoggedIn, async (req, res) => {
    try {
        const users = await User.find({ _id: { $ne: req.user._id } }); // Exclude the current user
        res.render('users', { users, currentUser: req.user,onlineUserIds: Array.from(onlineUsers.keys()) });
    } catch (err) {
        console.error(err);
        res.redirect('/login?status=error');
    }
});
app.get('/signup', (req, res) => {
    res.render('signup', { status: req.query.status });
});

app.post('/signup', async (req, res, next) => {
    try {
        const { username, email, password, gender } = req.body;
        const newUser = new User({ username, email, gender });;
        const registeredUser = await User.register(newUser, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            res.redirect('/users?status=success');
        });
    } catch (e) {
        console.error(e);
        res.redirect('/signup?status=error');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { status: req.query.status });
});
app.post('/logout', (req, res) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/login?status=success');
    });
});
app.post('/login', passport.authenticate('local', {
    successRedirect: '/users?status=success',
    failureRedirect: '/login?status=error'
}), (req, res) => {
    io.emit('register', req.user._id); // Register the socket ID after login
});
io.on('connection', (socket) => {

    // When a user registers, update their socket ID
    socket.on('register', (userId) => {
        // If the user is already registered with a socket ID, disconnect the old one
        if (onlineUsers.has(userId)) {
            const oldSocketId = onlineUsers.get(userId);
            if (oldSocketId !== socket.id) {
                console.log(`User ${userId} is reconnecting, removing old socket ${oldSocketId}`);
                io.sockets.sockets.get(oldSocketId)?.disconnect(); // Disconnect the old socket
            }
        }
    
        // Register the new socket ID
        onlineUsers.set(userId, socket.id);
    
        // Notify others this user is online
        socket.broadcast.emit('user status', { userId, status: 'online' });
    
        // Send all currently online users to the newly connected user
        for (let [onlineUserId] of onlineUsers.entries()) {
            socket.emit('user status', { userId: onlineUserId, status: 'online' });
        }
    });
    

    // Handle private messages
    socket.on('private message', async (data) => {
        const { from, to, msg } = data;
    
        // Create and save the initial message with "sent" status
        const chat = new Chat({ from, to, msg, status: 'sent' });
        await chat.save();
    
        // Default response payload
        const payload = {
            ...data,
            _id: chat._id,
            createdAt: chat.createdAt, // Include createdAt timestamp
        };
    
        const toSocketId = onlineUsers.get(to);
        if (toSocketId) {
            // Update to "delivered" and notify recipient
            chat.status = 'delivered';
            await chat.save();
    
            io.to(toSocketId).emit('private message', {
                ...payload,
                status: 'delivered'
            });
    
            // Update sender with delivered status
            socket.emit('private message', {
                ...payload,
                status: 'delivered'
            });
        } else {
            // If recipient is offline, send "sent" status back to sender
            socket.emit('private message', {
                ...payload,
                status: 'sent'
            });
        }
    });
    
    
    
    
    // When message is read
    socket.on('read message', async ({ messageId }) => {
        const chat = await Chat.findByIdAndUpdate(messageId, { status: 'read' });
        if (chat) {
            const fromSocket = onlineUsers.get(chat.from.toString());
            if (fromSocket) {
                io.to(fromSocket).emit('message read', { messageId });
            }
        }
    });
    

    // Handle disconnection
    // After a user registers with their socke
    
    socket.on('disconnect', () => {
        for (let [userId, socketId] of onlineUsers.entries()) {
            if (socketId === socket.id) {
                onlineUsers.delete(userId);
                socket.broadcast.emit('user status', { userId, status: 'offline' });
                break;
            }
        }
    });
    socket.on('group message', async (data) => {
        const { groupId, from, msg } = data;
      
        // Save group message
        const groupMsg = new GroupMessage({
          groupId,
          from,
          msg,
          readBy: [from] // Sender has read it
        });
      
        await groupMsg.save();
      
        // ✅ Populate sender so we have from._id and from.username
        const populatedMsg = await groupMsg.populate('from', 'username');
      
        // ✅ Create payload with populated sender
        const payload = {
          _id: populatedMsg._id,
          groupId,
          from: populatedMsg.from, // has _id and username
          msg: populatedMsg.msg,
          createdAt: populatedMsg.createdAt,
          readBy: populatedMsg.readBy
        };
      
        // ✅ Emit to all group members
        const group = await Group.findById(groupId).populate('members');
        for (let member of group.members) {
          const toSocket = onlineUsers.get(member._id.toString());
          if (toSocket) {
            io.to(toSocket).emit('group message', payload);
          }
        }
      });
      
    
      // Handle group message read
      socket.on('read group message', async ({ messageId, userId }) => {
        const message = await GroupMessage.findById(messageId);
        if (message && !message.readBy.includes(userId)) {
          message.readBy.push(userId);
          await message.save();
    
          const group = await Group.findById(message.groupId).populate('members');
          for (let member of group.members) {
            const toSocket = onlineUsers.get(member._id.toString());
            if (toSocket) {
              io.to(toSocket).emit('group message read', { messageId, userId });
            }
          }
        }
      });
    
});

app.get('/groupchat', isLoggedIn, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id }).populate('members');
    const users = await User.find({ _id: { $ne: req.user._id } });
    res.render('groupchat.ejs', { groups, currentUser: req.user,users });
  } catch (err) {
    console.error(err);
    res.redirect('/users?status=error');
  }
});

app.get('/:id/privatechat/:otherId', isLoggedIn, async (req, res) => {
    const { id, otherId } = req.params;
    const users = await User.find({ _id: { $ne: req.user._id } });
    try {
        const user = await User.findById(otherId); // Chat partner
        if (!user) return res.redirect('/users?status=error');

        const chats = await Chat.find({
            $or: [
                { from: id, to: otherId },
                { from: otherId, to: id }
            ]
        }).populate('from').populate('to');

        res.render('privatechat', { user, chats, currentUser: req.user,users,onlineUserIds: Array.from(onlineUsers.keys()) });
    } catch (err) {
        console.error(err);
        res.redirect('/users?status=error');
    }
});
app.post('/create/group', async (req, res) => {
    const { name, members } = req.body;
  
    try {
      const newGroup = new Group({
        name,
        members: [...members, req.user._id] // Add current user
      });
  
      await newGroup.save();
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Group creation failed' });
    }
  });
  
  app.get('/groupchat/:groupId', isLoggedIn, async (req, res) => {
    const groupId = req.params.groupId;
    try {
        const group = await Group.findById(groupId).populate('members');
        const users = await User.find({ _id: { $ne: req.user._id } });
        const chats = await GroupMessage.find({ groupId }).populate('from').populate('readBy');
        const groups= await Group.find({ members: req.user._id }).populate('members');
        if (chats) {
            chats.forEach(msg => {
                msg.isRead = msg.readBy.includes(req.user._id);
            });
        }

        if (!group) return res.status(404).send('Group not found');

        // Optional: Add messages when group chat messages are implemented
        res.render('group.ejs', { group, currentUser: req.user, users,chats,groups});
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading group chat');
    }
});
// Start server
server.listen(10000, () => {
    console.log('Server is running on port 10000');
});




