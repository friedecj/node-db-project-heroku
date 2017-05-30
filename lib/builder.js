var fs = require("fs");
var path = require("path");
var _ = require("underscore")._;
var config = require("../package.json");
var dbConfig = require("epa").getEnvironment()._config;
var Massive = require("massive");

var versionRoot = config.version.replace(/\./g, "-");
var sourceDir = path.join(__dirname, "../sql/", versionRoot);

var loadFiles = function(v) {
    //take our version name and join it to the path
    var dir = path.join(__dirname, "../sql/", v);
    //using glob for its pattern
    var glob = require("glob");
    //var globPattern = path.join(sourceDir, "**/*.sql");
    var globPattern = path.join(dir, "**/*.sql");

    // use nosort to ensure that init.sql is loaded first
    var files = glob.sync(globPattern, { nosort: true });
    //set a new string array, first line here is setting it to the schema

    var installResult = [];
    var rollbackResult = [];
    //find each file and push it to the string array
    _.each(files, function(file) {
        var sql = fs.readFileSync(file, { encoding: "utf-8" });
        if (!file.includes(".rb")) {
            //var sql = fs.readFileSync(file, { encoding: "utf-8" });
            installResult.push(sql);
        } else {
            rollbackResult.push(sql);
        }
    });
    rollbackResult.push("DELETE FROM public.schema_versions WHERE version_number = '" + v + "';");
    //return a full string for the upgrade
    return [installResult.join("\r\n"), rollbackResult.join("\r\n")];
};

//used to create the file name, can be refactored to be the version setter
var decideSqlFile = function() {
    var buildDir = path.join(__dirname, "../build");
    var fileName = versionRoot + ".sql";
    return path.join(buildDir, fileName);
};

//determine if the initial table exists
var migrationsEnabled = function(db) {
    var existSQL = "SELECT 1 AS exist FROM pg_class WHERE relname='schema_versions'";
    return db.runSync(existSQL);
};

//initialize the schema_version table
var initializeSchemaVersioning = function(db) {
    var initializeFile = path.join(__dirname, "../sql/init.sql");
    var initializeScript = fs.readFileSync(initializeFile, { encoding: "utf-8" });
    return db.runSync(initializeScript);
};

//get all the version folders by looping throught and getting the first level of folders under the sql folder
var getSourceVersions = function() {
    var srcPath = path.join(__dirname, "../sql/");
    var versions = fs.readdirSync(srcPath).filter(file => fs.lstatSync(path.join(srcPath, file)).isDirectory());
    return versions;
};

//get all the installed versions
var getInstalledVersions = function(db) {

    var versionSQL = "SELECT version_number FROM public.schema_versions";
    return db.runSync(versionSQL);
};

//insert new version that is being installed
var logNewInstalledVersion = function(db, v, installScript, rollbackScript) {
    return db.schema_versions.insert({ version_number: v, install_script: installScript, rollback_script: rollbackScript, version_status: "Pending" }, function(err, res) {});
};
//if version is successful update schema table that is was successful
var logUpdateInstalledVersion = function(db, v) {
    return db.schema_versions.update({ version_number: v, version_status: "Success" }, function(err, res) {
        //Array containing the destroyed record is returned
    });
};
//if version fails remove the version from the deployment talbe
var removedInstalledVersion = function(db, v) {
    return db.schema_versions.destroy({ version_number: v }, function(err, res) {
        //Array containing the destroyed record is returned
    });
};

exports.readSql = function() {
    var sqlBits = loadFiles();
    //write it to file
    var sqlFile = decideSqlFile();
    //writes the file to the filesystem, replace this to be a insert into the database
    fs.writeFileSync(sqlFile, sqlBits);
    return sqlBits;
};

exports.install = function() {
    var con = null;
    if (process.env.DATABASE_URL !== undefined) {
        con = { "connectionString": process.env.DATABASE_URL };
    }
    var db = Massive.connectSync(con || dbConfig);
    // first lets determine if we have the initial table for managing schemas
    var eDb = [];
    eDb = migrationsEnabled(db);
    //if we have the schemas table then lets move on else lets get it installed
    if (eDb.length !== 1) {
        //run the creation script
        //if this is inital deployments then we should run the init.sql script
        initializeSchemaVersioning(db);
        //if we have the initial sync lets resync by reconnecting
        db = Massive.connectSync(con || dbConfig);
    } else {
        console.log("Schema Migrations already exist");
    }
    // lets determine the what versions have been installed
    //what versions do we have in the sql file system?
    var versions = getSourceVersions();
    //console.log(versions);
    var installedVersions = getInstalledVersions(db);
    //console.log(installedVersions);

    var arrayCompare = require("array-compare");
    var versionsToInstall = arrayCompare(versions, installedVersions).missing;
    //from the missings node we can install the missing componenets
    versionsToInstall.forEach(function(v) {
        //load the install script string
        var sql = loadFiles(v.a);
        // insert that version into the database
        var result = logNewInstalledVersion(db, v.a, sql[0], sql[1]);
        // actually execute the schema update
        try {
            var dbUpgrade = db.runSync(sql[0]);
            var upInstalledVersion = logUpdateInstalledVersion(db, v.a);
            console.log(upInstalledVersion);
        } catch (err) {
            console.log("Unable to install version " + v.a + " Please review the log: " + err);
            var removeInstallLogEntry = removedInstalledVersion(db, v.a);
            //delete record from table
            //do we need to break this loop if we get an error?
        }
    });
    return null;
};