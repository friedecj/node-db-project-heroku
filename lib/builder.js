var fs = require("fs");
var path = require("path");
var _ = require("underscore")._;
var config = require("../package.json");
var dbConfig = require("epa").getEnvironment()._config;
var Massive = require("massive");


var loadFiles = function(v) {
    //take our version name and join it to the path
    var dir = path.join(__dirname, "../sql/", v);
    //using glob for its pattern
    var glob = require("glob");
    var globPattern = path.join(dir, "**/*.sql");
    // use nosort to ensure that init.sql is loaded first
    var files = glob.sync(globPattern, { nosort: true });
    //set a new string array, first line here is setting it to the schema

    var installResult = [];
    var rollbackResult = [];
    //find each file and push it to the string array
    _.each(files, function(file) {
        var sql = fs.readFileSync(file, { encoding: "utf-8" });
        if (!file.includes("-rb")) {
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

//determine if the initial table exists
var migrationsEnabled = function(db) {
    var existSQL = "SELECT 1 AS exist FROM pg_class WHERE relname='schema_versions;'";
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

    var versionSQL = "SELECT version_number FROM public.schema_versions;";
    var installedVersions = db.runSync(versionSQL);
    var installed = [];
    installedVersions.forEach(function(v) {
        installed.push(v.version_number);
    });
    return installed;
};

//insert new version that is being installed
var logNewInstalledVersion = function(db, v, installScript, rollbackScript) {
    return db.runSync(`INSERT INTO public.schema_versions (version_number, install_script, rollback_script, version_status) 
                       VALUES ($1, $2, $3, 'PENDING');`, [v, installScript, rollbackScript]);
};

//if version is successful update schema table that is was successful
var logUpdateInstalledVersion = function(db, v) {
    return db.runSync(`UPDATE public.schema_versions 
                       SET version_status = 'SUCCESS' 
                       WHERE version_number = $1;`, [v]);
};

//if version fails remove the version from the deployment talbe
var removedInstalledVersion = function(db, v) {
    return db.runSync("DELETE FROM public.schema_versions WHERE version_number = $1", [v]);
};

//get the versions and their rollback scripts
var getVersionsToRemove = function(db, v) {
    //we don't need everything just need the rollback script with the version
    return db.runSync(`SELECT version_number, rollback_script FROM public.schema_versions 
                        WHERE id > (SELECT id FROM public.schema_versions  
                        WHERE version_number = $1) 
                        ORDER BY version_number DESC;`, [v]);
};

//create the db connection that can be used for each function
var createConnection = function() {
    var con = null;
    if (process.env.DATABASE_URL !== undefined) {
        con = { "connectionString": process.env.DATABASE_URL };
    }
    var db = Massive.connectSync(con || dbConfig);
    return db;
};

exports.install = function() {
    var db = createConnection();
    // first lets determine if we have the initial table for managing schemas
    var eDb = [];
    eDb = migrationsEnabled(db);
    //if we have the schemas table then lets move on else lets get it installed
    if (eDb.length !== 1) {
        //run the creation script
        //if this is inital deployments then we should run the init.sql script
        initializeSchemaVersioning(db);
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
            console.log("Trying to upgrade to version " + v.a);
            var dbUpgrade = db.runSync(sql[0]);
            var upInstalledVersion = logUpdateInstalledVersion(db, v.a);
            console.log("Upgrade to version " + v.a + " was Successful");
        } catch (err) {
            console.log("Unable to install version " + v.a + " Please review the log: " + err);
            var removeInstallLogEntry = removedInstalledVersion(db, v.a);
            //delete record from table
            //do we need to break this loop if we get an error?
        }
    });
};

//the rollback command with a versionNumber can be used to rollback the database to that version
//versionNumber is the number of the version that will be still installed in the db.
exports.rollback = function() {
    console.log("Starting to rollback");
    /*how does this behave?  I assume if we rollback, we can specify the version number 
      this will need to be tested for behavior in Heroku
      assuming we get the version number we are moving to
      get all the version numbers installed to that point and uninstall them in reverse order
      step one get all the versions in the db and their rollback scripts
      in reverse order execute the rollback scripts
      create our connection to the database*/
    var db = createConnection();
    //get the versions we need to remove
    if (process.argv[3] !== undefined) {
        var versionsToRemove = getVersionsToRemove(db, process.argv[3]);
    }
    //with these version execute each removal script
    versionsToRemove.forEach(function(v) {
        //this should be in the right order due to the order by sql script so 
        try {
            console.log("Trying to rollback version " + v.version_number);
            var dbRollback = db.runSync(v.rollback_script);
            console.log("Rollback of version " + v.version_number + " was Successful");
        } catch (err) {
            console.log("Unable to uninstall version " + v.version_number + " Please review the log: " + err);
        }
    });
};