module.exports = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).send("Not logged in");
    }

    if (!req.session.user.isAdmin) {
        return res.status(403).send("Admin only");
    }

    next();
};