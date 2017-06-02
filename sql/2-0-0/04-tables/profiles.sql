create table membership.profiles(
    id integer primary key not null,
    description varchar(24) not null
);

create table membership.users_profiles(
    user_id bigint not null,
    profile_id int not null,
    primary key (user_id, profile_id)
);

-- default roles
insert into membership.profiles (id, description) values(10, 'Administrator');
insert into membership.profiles (id, description) values(99, 'User');
