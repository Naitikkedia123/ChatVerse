const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const chatSchema = new Schema({
    from: { type: Schema.Types.ObjectId, ref: 'User' },
    to: { type: Schema.Types.ObjectId, ref: 'User' },
    msg: String,
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent'
    }
  }, { timestamps: true });  // <-- This adds createdAt and updatedAt
  

module.exports = mongoose.model('Chat', chatSchema);
