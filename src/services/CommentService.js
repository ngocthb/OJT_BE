const CommentModel = require("../models/CommentModel");
const ClaimModel = require("../models/ClaimModel");
const UserModel = require("../models/UserModel");
const ReplyModel = require("../models/ReplyModel");

const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const createComment = async (user_id, claim_id, content, role) => {
  return new Promise(async (resolve, reject) => {
    try {
      const userCreate = await UserModel.findById(user_id);

      const claim = await ClaimModel.findById(claim_id).populate(
        "user_id",
        "email"
      );
      if (!claim) {
        return reject({
          status: "ERR",
          message: "Claim not found",
        });
      }
      const emailUserOwner = claim?.user_id?.email;

      const commentDoc = new CommentModel({
        claim_id,
        user_id,
        content,
      });

      const result = await commentDoc.save();
      if (emailUserOwner !== userCreate.email) {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: emailUserOwner,
          subject: "New Comment on Your Claim",
          html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #007bff; text-align: center;">📢 New Comment on Your Claim</h2>
            <p style="font-size: 16px;">Hello,</p>
            <p style="font-size: 16px;">You have received a new comment on your claim at <strong>${new Date().toLocaleString()}</strong>:</p>
            
            <div style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; background-color: #f3f3f3;">
            

              <div>
                <p style="margin: 0; font-size: 16px; font-weight: bold;">${
                  userCreate.user_name
                } (${role.role})</p>
                <p style="margin: 0; font-size: 14px; color: #666;">${
                  userCreate.email
                }</p>
              </div>
            </div>
      
            <div style="margin-top: 15px; padding: 10px; border-left: 4px solid #007bff; background-color: #f9f9f9; border-radius: 5px;">
              <p style="font-size: 16px; font-style: italic;">"${content}"</p>
            </div>
      
            <p style="font-size: 16px; margin-top: 15px;">You can check the full details of your claim in your account.</p>
            <a href="http://localhost:5173/claimer/pending/${claim_id}" style="display: block; text-align: center; padding: 10px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 16px; margin-top: 10px;">
              View Claim
            </a>
      
            <hr style="border: 0.5px solid #ddd; margin-top: 20px;">
            <p style="text-align: center; font-size: 12px; color: #666;">&copy; 2024 Your Company. All rights reserved.</p>
          </div>
        `,
        });
      }

      resolve({
        status: "OK",
        message: "Successfully create comment",
        data: result,
      });
    } catch (error) {
      reject(error);
    }
  });
};

const getComments = async (claim_id) => {
  return new Promise(async (resolve, reject) => {
    try {
      let comments = await CommentModel.find({ claim_id }).populate({
        path: "user_id",
        select: "user_name avatar role",
        populate: {
          path: "role_id",
          select: "name",
        },
      });

      if (!comments || comments.length === 0) {
        return resolve({
          status: "OK",
          message: "Comments not found",
        });
      }

      const replies = await ReplyModel.find(
        { comment_id: { $in: comments.map((c) => c._id) } },
        "reply"
      );

      const repliedCommentIds = new Set(
        replies.flatMap((r) => r.reply.map((id) => id.toString()))
      );

      const filteredComments = comments.filter(
        (comment) => !repliedCommentIds.has(comment._id.toString())
      );

      const commentsWithReplies = await Promise.all(
        filteredComments.map(async (comment) => {
          const replies = await ReplyModel.find({
            comment_id: comment._id,
          }).populate({
            path: "reply",
            populate: {
              path: "user_id",
              select: "user_name avatar role_id",
              populate: {
                path: "role_id",
                select: "name",
              },
            },
          });

          return {
            ...comment.toObject(),
            replies:
              replies?.flatMap(
                (reply) =>
                  reply?.reply?.map((r) => ({
                    _id: r._id,
                    claim_id: r.claim_id,
                    content: r.content,
                    createdAt: r.createdAt,
                    user: r.user_id
                      ? {
                          _id: r.user_id._id,
                          user_name: r.user_id.user_name,
                          avatar: r.user_id.avatar,
                          role: r.user_id?.role_id?.name || null,
                        }
                      : null,
                  })) || []
              ) || [],
          };
        })
      );

      resolve({
        status: "OK",
        data: commentsWithReplies,
      });
    } catch (error) {
      reject(error);
    }
  });
};

const checkComment = async (comment_id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const comment = await CommentModel.findById(comment_id);

      if (!comment) {
        return reject({
          status: "ERR",
          message: "Comment not found",
        });
      }

      resolve({
        status: "OK",
        data: comment,
      });
    } catch (error) {
      reject(error);
    }
  });
};

const replyComment = async (
  user_id,
  comment_id,
  reply_id,
  claim_id,
  content,
  role
) => {
  return new Promise(async (resolve, reject) => {
    try {
      const userCreate = await UserModel.findById(user_id);
      const reply = await CommentModel.findById(reply_id);
      if (!reply) {
        return reject({ status: "ERR", message: "Reply comment not found" });
      }

      const userBeReply = await CommentModel.findById(comment_id).populate({
        path: "user_id",
        select: "user_name email",
      });

      if (userBeReply.user_id.email !== userCreate.email) {
        return reject({
          status: "ERR",
          message: "You are not the owner of this comment",
        });
      }

      let replyDoc = await ReplyModel.findOne({ comment_id });

      if (!replyDoc) {
        replyDoc = new ReplyModel({
          comment_id,
          reply: [reply_id],
        });
      } else {
        if (!replyDoc.reply.includes(reply_id)) {
          replyDoc.reply.push(reply_id);
        }
      }

      const result = await replyDoc.save();

      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: userBeReply.user_id.email,
        subject: "New Reply on Your Comment",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #007bff; text-align: center;">📢 New Reply on Your Comment</h2>
            <p style="font-size: 16px;">Hello,</p>
            <p style="font-size: 16px;">You have received a new comment on your claim at <strong>${new Date().toLocaleString()}</strong>:</p>
            
            <div style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; background-color: #f3f3f3;">
            

              <div>
                <p style="margin: 0; font-size: 16px; font-weight: bold;">${
                  userCreate.user_name
                } (${role.role})</p>
                <p style="margin: 0; font-size: 14px; color: #666;">${
                  userCreate.email
                }</p>
              </div>
            </div>
      
            <div style="margin-top: 15px; padding: 10px; border-left: 4px solid #007bff; background-color: #f9f9f9; border-radius: 5px;">
              <p style="font-size: 16px; font-style: italic;">"${content}"</p>
            </div>
      
            <p style="font-size: 16px; margin-top: 15px;">You can check the full details of your claim in your account.</p>
            <a href="http://localhost:5173/claimer/pending/${claim_id}" style="display: block; text-align: center; padding: 10px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 16px; margin-top: 10px;">
              View Claim
            </a>
      
            <hr style="border: 0.5px solid #ddd; margin-top: 20px;">
            <p style="text-align: center; font-size: 12px; color: #666;">&copy; 2024 Your Company. All rights reserved.</p>
          </div>
        `,
      });

      resolve({
        status: "OK",
        message: "Successfully added reply",
        data: result,
      });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  createComment,
  getComments,
  checkComment,
  replyComment,
};
