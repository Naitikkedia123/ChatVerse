module.exports.isLoggedIn = (req, res, next) => {
    if(!req.isAuthenticated()) {
        return res.redirect('/login?status=not_authenticated');
    }
    next();
}
