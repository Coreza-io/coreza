# Contributing to Coreza Trading Platform

Thank you for your interest in contributing to Coreza! This document provides guidelines and instructions for contributing.

## 🤝 Code of Conduct

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive in your interactions.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/coreza.git
   cd coreza
   ```
3. **Set up your environment** by running:
   ```bash
   node setup/setup.js
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 📝 Development Workflow

### Before You Start

- Check existing [Issues](https://github.com/Coreza-io/coreza/issues) to see if your idea is already being discussed
- For major changes, open an issue first to discuss your proposed changes
- Make sure all tests pass before submitting

### Making Changes

1. **Write clean, documented code**
   - Add JSDoc comments for functions and classes
   - Follow the existing code style
   - Use TypeScript types properly

2. **Add tests** for new features
   - Unit tests for services and utilities
   - Integration tests for workflows
   - Test edge cases and error handling

3. **Update documentation**
   - Update README.md if needed
   - Add inline code comments for complex logic
   - Update API documentation

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```
   
   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting, etc.)
   - `refactor:` Code refactoring
   - `test:` Adding or updating tests
   - `chore:` Maintenance tasks

### Testing

```bash
# Run frontend tests
npm test

# Run backend tests
cd coreza-backend
npm test

# Run all tests
npm run test:all
```

### Code Style

- **TypeScript**: Use strict mode and proper typing
- **Formatting**: 2 spaces for indentation
- **Naming**: 
  - `camelCase` for variables and functions
  - `PascalCase` for classes and interfaces
  - `UPPER_CASE` for constants
- **Files**: Use descriptive names, one main export per file

## 🔍 Pull Request Process

1. **Update your branch** with the latest main:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your changes**:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Reference any related issues
   - Describe your changes in detail
   - Include screenshots for UI changes
   - List any breaking changes

4. **Address review feedback**:
   - Respond to comments
   - Make requested changes
   - Push updates to your branch

5. **Merge requirements**:
   - All tests must pass
   - Code review approval required
   - No merge conflicts
   - Documentation updated

## 🐛 Reporting Bugs

When reporting bugs, please include:

- **Description**: Clear description of the issue
- **Steps to Reproduce**: Detailed steps to recreate the bug
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: OS, Node version, browser, etc.
- **Logs**: Relevant error messages or logs
- **Screenshots**: If applicable

## 💡 Feature Requests

For feature requests, please describe:

- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How should it work?
- **Alternatives**: Other approaches you've considered
- **Additional Context**: Any other relevant information

## 🏗️ Project Structure

```
coreza/
├── src/                    # Frontend React application
│   ├── components/         # React components
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page components
│   ├── utils/             # Utility functions
│   └── nodes/             # Node definitions
├── coreza-backend/         # Backend Node.js application
│   └── src/
│       ├── routes/        # API routes
│       ├── services/      # Business logic
│       ├── middleware/    # Express middleware
│       └── nodes/         # Node executors
├── supabase/              # Supabase configuration
│   └── functions/         # Edge functions
├── tests/                 # Test suites
└── docs/                  # Documentation
```

## 📚 Resources

- [Architecture Documentation](docs/SETUP.md)
- [Security Guidelines](docs/SECURITY.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## 📜 License

By contributing to Coreza, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) and become part of the open-source Coreza codebase.

## 🧾 Contributor License Agreement (CLA)

- All contributors must sign the Coreza CLA before pull requests can be merged. You will be prompted to review and sign the CLA as part of the PR workflow.
- By signing the CLA, you affirm that you have the right to contribute the code and that Coreza can distribute it under the AGPL-3.0 license.

## 🧭 Feature Request Prioritization

We prioritize feature requests based on:

- **Impact**: How many users and workflows will benefit from the change.
- **Strategic alignment**: Relevance to Coreza’s roadmap for orchestrating trading and data automation.
- **Security and reliability**: Enhancements that improve robustness, compliance, or observability are prioritized.
- **Community signal**: Upvotes, discussions, and well-documented use cases help requests move up the queue.

## 🙏 Recognition

All contributors will be recognized in our README.md. Thank you for helping make Coreza better!

---

**Questions?** Feel free to open an issue or reach out to the maintainers.
