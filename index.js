///<reference path="./node_modules/node-ts/build/node-ts.d.ts"/>
var program = require("commander");
var builder = require("./lib/builder");

program
    .command('install')
    .description('Building and Installing our database version')
    .action(function() {
        console.log("Installing");
        builder.install();
        console.log("done");
    });

program
    .command('rollback')
    .description('The removal of a database version')
    .action(function() {
        console.log("Rolling back to version " + process.argv[3]);
        builder.rollback();
        console.log("done");
    });
program.parse(process.argv);