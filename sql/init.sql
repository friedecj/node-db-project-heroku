--set the schema to the public schema, this is similar to the dbo schema in sql server
SET search_path TO public;
--if the table doesn't already exist then create a new table'
CREATE TABLE IF NOT EXISTS schema_versions (
    id serial CONSTRAINT pk_schema_versions PRIMARY KEY,
    version_number varchar(50) NOT NULL,
    CONSTRAINT uc_schema_versions_version_number UNIQUE(version_number),
    install_script text NOT NULL,
    rollback_script text NULL,
    install_date timestamp NOT NULL DEFAULT NOW(),
    version_status varchar(50) NOT NULL)