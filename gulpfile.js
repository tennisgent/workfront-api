/**
 * Copyright 2015 Workfront
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

var gulp = require('gulp-help')(require('gulp'));

var BUILD_DIR = './dist/';
var COVERAGE_DIR = './coverage/';

gulp.task('default', false, ['help']);

/**
 * Empties BUILD_DIR and cleans coverage data
 */
gulp.task('clean', 'Empty '+BUILD_DIR+' folder and remove generated coverage data from '+COVERAGE_DIR, ['clean-coverage', 'clean-build']);

/**
 * Empties BUILD_DIR
 */
gulp.task('clean-build', false, [], function(cb) {
	var del = require('del');
	del([BUILD_DIR + '*'], cb);
});

/**
 * Cleans coverage data
 */
gulp.task('clean-coverage', false, [], function(cb) {
	var del = require('del');
	del([COVERAGE_DIR], cb);
});


/**
 * Generates browser-ready version for API in BUILD_DIR
 * File will be named as workfront.js, minified version will be workfront.min.js
 */
gulp.task('build', 'Generates browser-ready version for API in '+BUILD_DIR, ['clean-build'], function() {
	var browserify = require('browserify');
	var source = require('vinyl-source-stream');
	var buffer = require('vinyl-buffer');
	var uglify = require('gulp-uglify');
	var rename = require('gulp-rename');
	return browserify(
		'./index.js',
		{
			standalone: 'Workfront'
		}
	)
		.ignore('promise/polyfill')
		.exclude('./plugins/upload')
		.bundle()
		.pipe(source('workfront.js'))
		.pipe(buffer())
		.pipe(gulp.dest(BUILD_DIR))
		.pipe(rename({ extname: '.min.js' }))
		.pipe(uglify())
		.pipe(gulp.dest(BUILD_DIR));
});


function generateDocs(destinationPath) {
	var jsdoc = require("gulp-jsdoc");
	return gulp.src(["src/**/*.js", "README.md"])
		.pipe(
		jsdoc(destinationPath, {
			path: 'ink-docstrap',
			systemName: 'workfront-api',
			//footer: "Something",
			//copyright: "Something",
			navType: "vertical",
			theme: "united",
			linenums: true,
			collapseSymbols: false,
			inverseNav: false
		})
	);
}

function publishDocs(cb) {
	var shell = require('shelljs'),
		path = require('path'),
		os = require('os'),
		dateformat = require('dateformat');

	if (!shell.which('git')) {
		cb('Sorry, git command was not found.');
		return;
	}

	var ghPagesDir = path.join(os.tmpdir(), 'gh-pages'),
		currentDir = process.cwd();
	shell.rm('-rf', ghPagesDir);
	shell.mkdir(ghPagesDir);
	shellExec('git clone -b gh-pages https://github.com/Workfront/workfront-api.git "'+ghPagesDir+'"');
	shell.rm('-rf', path.join(ghPagesDir, '*'));

	var stream = generateDocs(ghPagesDir);
	stream.on('finish', function() {
		shell.cd(ghPagesDir);
		shellExec('git add -A .');
		shellExec('git commit -m "Autogenerated new docs at ' + dateformat(new Date()) + '"');
		shellExec('git fetch origin && git rebase origin/gh-pages');
		shellExec('git push origin gh-pages');

		shell.cd(currentDir);
		shell.rm('-rf', ghPagesDir);
		cb();
	});
	stream.on('error', function(e) {
		cb('Error ' + e.name + ': ' + e.message);
	});
}

/**
 * Splits a command result to separate lines.
 * @param {String} result The command result string.
 * @returns {String[]} The separated lines.
 */
function splitCommandResultToLines(result) {
	return result.trim().split("\n");
}

/**
 * Returns sorted array of version tags
 * @returns {String[]}
 */
function getVersionTags() {
	var semver = require('semver');

	var tags = splitCommandResultToLines(shellExec("git tag", { silent: true }));

	return tags.reduce(function(list, tag) {
		if (semver.valid(tag)) {
			list.push(tag);
		}
		return list;
	}, []).sort(semver.compare);
}

function generateChangelog() {
	var shell = require('shelljs'),
		dateformat = require('dateformat');

	// get most recent two tags
	var tags = getVersionTags(),
		rangeTags,
		now = new Date(),
		timestamp = dateformat(now, "mmmm d, yyyy");

	var header;
	if (tags.length > 1) {
		rangeTags = tags.slice(tags.length - 2);
		header = rangeTags[1] + " - " + timestamp + "\n";
	}
	else if (tags.length === 1) {
		rangeTags = tags.slice(tags.length - 1);
		header = rangeTags[0] + " - " + timestamp + "\n";
	}
	else {
		rangeTags = [];
		header = timestamp + "\n";
	}

	// output header
	header.to("CHANGELOG.tmp");

	// get log statements
	var logs = shellExec("git log --pretty=format:\"* %s (%an)\" " + rangeTags.join(".."), {silent: true}).split(/\n/g);
	logs = logs.filter(function(line) {
		return line.indexOf("Merge pull request") === -1 && line.indexOf("Merge branch") === -1;
	});
	logs.push(""); // to create empty lines
	logs.unshift("");

	// output log statements
	logs.join("\n").toEnd("CHANGELOG.tmp");

	shell.cat("CHANGELOG.tmp", "CHANGELOG.md").to("CHANGELOG.md.tmp");
	shell.rm("CHANGELOG.tmp");
	shell.rm("CHANGELOG.md");
	shell.mv("CHANGELOG.md.tmp", "CHANGELOG.md");
}

/**
 * Creates a release version tag and pushes to origin.
 * @param {String} type   The type of release to do (patch, minor, major)
 * @param {Function} cb    Callback
 * @returns {void}
 */
function release(type, cb) {
	var testsStream = runTests();
	testsStream.on('error', cb);
	testsStream.on('end', function() {
		try {
			var newVersion = shellExec("npm version " + type, { silent: true }).trim();
			generateChangelog();

			// add changelog to commit
			shellExec("git add CHANGELOG.md");
			shellExec("git commit --amend --no-edit");

			// replace existing tag
			shellExec("git tag -f " + newVersion);

			// push all the things
			shellExec("git push origin master --tags");

			shellExec("npm publish");
			publishDocs(cb);
		}
		catch(e) {
			cb(e);
		}
	});
}

function shellExec() {
	var shell = require('shelljs');
	var execResult = shell.exec.apply(shell, arguments);
	if (execResult.code) {
		throw new Error(execResult.output);
	}
	return execResult.output;
}


/**
 * Generate API documentation in ./docs/ folder
 */
gulp.task('docs', 'Generate API documentation in ./docs/ folder', [], function() {
	return generateDocs('./docs/');
});


/**
 * Generate and publish API documentation to gh-pages branch
 */
gulp.task('publish-docs', 'Generate and publish API documentation to http://workfront.github.io/workfront-api/', [], function(cb) {
	publishDocs(cb);
});


function runTests() {
	var mocha = require('gulp-mocha');
	return gulp.src('test/**/*.spec.js', {read: false})
		.pipe(mocha({}));
}

/**
 * Do patch release
 */
gulp.task('release-patch', 'Do patch release', [], function(cb) {
	release('patch', cb);
});

/**
 * Do minor release
 */
gulp.task('release-minor', 'Do minor release', [], function(cb) {
	release('minor', cb);
});

/**
 * Do major release
 */
gulp.task('release-major', 'Do major release', [], function(cb) {
	release('major', cb);
});

/**
 * Runs all tests
 */
gulp.task('test', 'Run all tests', [], runTests);

/**
 * Runs all tests with coverage
 */
gulp.task('test-coverage', 'Run all tests and generate coverage data in '+COVERAGE_DIR+' folder', ['clean-coverage'], function(cb) {
	var istanbul = require('gulp-istanbul');

	gulp.src(['src/**/*.js'])
		.pipe(istanbul()) // Covering files
		.pipe(istanbul.hookRequire()) // Force `require` to return covered files
		.on('finish', function () {
			runTests()
				.pipe(istanbul.writeReports()) // Creating the reports after tests runned
				.on('end', cb);
		});
});

/**
 * This intended to be run only on Travis CI.
 * Runs all tests with coverage, when upload coverage data to coveralls.io
 */
gulp.task('test-ci', false, ['test-coverage'], function() {
	var coveralls = require('gulp-coveralls');
	return gulp.src(COVERAGE_DIR + 'lcov.info')
		.pipe(coveralls());
});
