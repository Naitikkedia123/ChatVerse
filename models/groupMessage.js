const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const groupMessageSchema = new Schema({
  groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
  from: { type: Schema.Types.ObjectId, ref: 'User' },
  msg: String,
  createdAt: { type: Date, default: Date.now },
  readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
