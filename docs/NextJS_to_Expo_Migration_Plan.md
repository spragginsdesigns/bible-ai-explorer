# NextJS to Expo Migration: Bible AI Explorer

## Table of Contents

- [NextJS to Expo Migration: Bible AI Explorer](#nextjs-to-expo-migration-bible-ai-explorer)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Task Description](#task-description)
    - [Scope](#scope)
  - [Database Insights](#database-insights)
    - [Query Summary](#query-summary)
    - [Schema Details](#schema-details)
      - [Key Tables \& Fields](#key-tables--fields)
      - [Structural Observations](#structural-observations)
  - [Web Resources](#web-resources)
    - [Documentation Links](#documentation-links)
      - [Expo \& React Native](#expo--react-native)
      - [Vector Database \& AstraDB](#vector-database--astradb)
    - [Supplementary Resources](#supplementary-resources)
  - [Codebase Analysis](#codebase-analysis)
    - [Project Structure Overview](#project-structure-overview)
    - [File Listings \& Relative Paths](#file-listings--relative-paths)
      - [Core Components](#core-components)
      - [API Routes](#api-routes)
      - [Utilities](#utilities)
    - [Code Insights \& Dependencies](#code-insights--dependencies)
      - [Key Dependencies](#key-dependencies)
      - [Critical Code Sections](#critical-code-sections)
  - [Additional Insights](#additional-insights)
    - [Authentication Considerations](#authentication-considerations)
    - [UI/UX Adaptation](#uiux-adaptation)
    - [Vector Database Integration](#vector-database-integration)
    - [Note-Taking Feature](#note-taking-feature)
  - [Summary and Recommendations](#summary-and-recommendations)
    - [Detailed Migration Plan](#detailed-migration-plan)
      - [Phase 1: Project Setup and Environment Configuration](#phase-1-project-setup-and-environment-configuration)
      - [Phase 2: Core Functionality Migration](#phase-2-core-functionality-migration)
      - [Phase 3: Feature Enhancement](#phase-3-feature-enhancement)
      - [Phase 4: Testing and Deployment](#phase-4-testing-and-deployment)
    - [Concise Key Takeaways](#concise-key-takeaways)

---

## Overview

### Task Description

Transform the Bible AI Explorer web application from a NextJS-based web app to a React Native Expo mobile application primarily for Android. The mobile app should maintain the core functionality of the web app while implementing a sleek gold and black design aesthetic. The app should also include note-taking capabilities for personal Bible study.

### Scope

- Maintain the core Bible AI question-answering functionality
- Preserve the vector database integration with AstraDB for Bible text retrieval
- Implement the same system prompt for AI responses
- Add note-taking features for personal Bible study
- Replace or modify Tavily search integration
- Design with a sleek gold and black color scheme
- Focus primarily on Android platform with Expo

---

## Database Insights

### Query Summary

For the Bible AI Explorer mobile app migration, we will need the following database tables:

1. **users** - Stores user profile information

   - Linked to Clerk authentication
   - Contains user preferences and settings

2. **bible_verses** - Stores the KJV Bible text

   - Contains verse text, references, and metadata
   - Used for retrieval and display in the app

3. **user_notes** - Stores user-created notes for Bible study

   - Contains fields for note content, creation/update timestamps
   - Links to users via Clerk user ID
   - Stores content as JSONB, allowing for rich text formatting

4. **chat_history** - Stores conversation history

   - Records user questions and AI responses
   - Links to users via Clerk user ID

5. **vector_embeddings** - Stores vector embeddings for Bible verses
   - Contains vector representations for semantic search
   - Links to bible_verses table

### Schema Details

#### Key Tables & Fields

**users table:**

```
id (UUID, primary key)
clerk_id (VARCHAR)
email (VARCHAR)
username (VARCHAR)
created_at (TIMESTAMP WITH TIME ZONE)
updated_at (TIMESTAMP WITH TIME ZONE)
preferences (JSONB)
```

**bible_verses table:**

```
id (UUID, primary key)
book (VARCHAR)
chapter (INTEGER)
verse (INTEGER)
text (TEXT)
reference (VARCHAR)
created_at (TIMESTAMP WITH TIME ZONE)
```

**user_notes table:**

```
id (UUID, primary key)
user_id (UUID, foreign key to users.id)
title (VARCHAR)
content (JSONB)
verse_reference (VARCHAR)
tags (VARCHAR[])
created_at (TIMESTAMP WITH TIME ZONE)
updated_at (TIMESTAMP WITH TIME ZONE)
```

**chat_history table:**

```
id (UUID, primary key)
user_id (UUID, foreign key to users.id)
question (TEXT)
answer (TEXT)
created_at (TIMESTAMP WITH TIME ZONE)
```

**vector_embeddings table:**

```
id (UUID, primary key)
verse_id (UUID, foreign key to bible_verses.id)
embedding (VECTOR)
created_at (TIMESTAMP WITH TIME ZONE)
```

#### Structural Observations

- The database will use Clerk for authentication, which has React Native SDK support
- The user_notes table uses JSONB for content storage, allowing for rich text formatting
- The vector_embeddings table stores vector representations for semantic search
- All tables include timestamps for data synchronization
- The database will be accessed from the mobile app via API endpoints

---

## Web Resources

### Documentation Links

#### Expo & React Native

- [Expo Documentation](https://docs.expo.dev/) - Official documentation for Expo development
- [React Native Documentation](https://reactnative.dev/docs/getting-started) - Official React Native documentation
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/) - File-based routing for Expo apps

#### Vector Database & AstraDB

- [AstraDB Documentation](https://docs.datastax.com/en/astra-db/docs/) - Official documentation for AstraDB
- [AstraDB Vector Search](https://docs.datastax.com/en/astra-db/docs/vector-search/overview.html) - Documentation for vector search capabilities
- [AstraDB React Native Integration](https://docs.datastax.com/en/astra-db/docs/react-native/quickstart.html) - Guide for integrating AstraDB with React Native

### Supplementary Resources

- [Migrating from Next.js to React Native](https://blog.logrocket.com/migrating-next-js-app-react-native/) - Guide on migration strategies
- [React Native Vector Icons](https://github.com/oblador/react-native-vector-icons) - Popular icon library for React Native
- [React Native Paper](https://callstack.github.io/react-native-paper/) - Material Design components for React Native
- [AsyncStorage Documentation](https://react-native-async-storage.github.io/async-storage/) - Local storage solution for React Native

---

## Codebase Analysis

### Project Structure Overview

The Bible AI Explorer is a NextJS application with the following structure:

- `/src/app` - NextJS app router pages and API routes
- `/src/components` - React components for the UI
- `/src/utils` - Utility functions including AstraDB connection and system prompt
- `/src/lib` - Library code and shared functionality
- `/biblical-texts` - Contains the KJV Bible text used for the vector database
- `/docs` - Documentation files

The application uses:

- NextJS for the web framework
- OpenAI for AI completions
- AstraDB for vector storage and retrieval
- Tavily for web search integration
- TailwindCSS for styling

### File Listings & Relative Paths

#### Core Components

- `src/components/BibleAIExplorer.tsx` - Main application component
- `src/components/QuestionInput.tsx` - User input component
- `src/components/ChatHistory.tsx` - Displays conversation history
- `src/components/ClientResponse.tsx` - Renders AI responses
- `src/components/TavilyResults.tsx` - Displays search results
- `src/components/useChat.ts` - Custom hook for chat functionality

#### API Routes

- `src/app/api/ask-question/route.ts` - Endpoint for AI question answering
- `src/app/api/tavily-search/route.ts` - Endpoint for Tavily search integration

#### Utilities

- `src/utils/astraDb.ts` - AstraDB connection and configuration
- `src/utils/systemPrompt.ts` - System prompt for AI responses
- `src/utils/commonQuestions.ts` - Predefined questions for the app

### Code Insights & Dependencies

#### Key Dependencies

- `@datastax/astra-db-ts` - AstraDB TypeScript client
- `@langchain/core` and `@langchain/openai` - LangChain integration
- `openai` - OpenAI API client
- `next` - NextJS framework
- `react` and `react-dom` - React library
- `tailwindcss` - Utility-first CSS framework

#### Critical Code Sections

**AstraDB Integration (`src/utils/astraDb.ts`):**

```typescript
import { DataAPIClient } from "@datastax/astra-db-ts";

// Initialize the client
const client = new DataAPIClient(process.env.ASTRA_DB_TOKEN as string);
const db = client.db(process.env.ASTRA_DB_ENDPOINT as string, {
	namespace: "default_keyspace"
});

export const astraDb = db;
```

**Vector Search Implementation (`src/app/api/ask-question/route.ts`):**

```typescript
async function performSimilaritySearch(query: string): Promise<string> {
	// Generate query vector using OpenAI embeddings
	const queryVector = await embeddings.embedQuery(query);

	// Query AstraDB collection with vector search
	const collection = astraDb.collection("openai_embedding_collection");
	const results = await collection
		.find(
			{},
			{
				sort: {
					$vector: queryVector
				},
				limit: 5,
				projection: { v: 1 },
				includeSimilarity: true
			}
		)
		.toArray();

	// Format and return results
	return formattedResults;
}
```

**Chat Hook Implementation (`src/components/useChat.ts`):**

```typescript
export const useChat = (initialQuery: string = "") => {
  // State management for chat
  const [query, setQuery] = useState<string>(initialQuery);
  const [response, setResponse] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    // Perform Tavily search
    const tavilyResponse = await fetch("/api/tavily-search", {...});

    // Perform Bible AI query
    const response = await fetch("/api/ask-question", {...});

    // Update state with response
    // ...
  };

  return {
    query, setQuery, response, history, handleSubmit,
    // other state and functions
  };
};
```

---

## Additional Insights

### Authentication Considerations

- The app will use Clerk for authentication, which has React Native SDKs available
- User data is stored in a PostgreSQL database with user_id and clerk_id fields
- The mobile app will need to implement secure token storage using Expo SecureStore

### UI/UX Adaptation

- The current web app uses a responsive layout that will need to be redesigned for mobile
- The app has a chat-like interface that should translate well to mobile with some adjustments
- The gold and black color scheme should be implemented using React Native's styling system

### Vector Database Integration

- AstraDB provides a JavaScript/TypeScript client that can be used in React Native
- The vector search functionality will need to be moved to a backend API or adapted for mobile
- The KJV Bible text is stored in a vector database for semantic search

### Note-Taking Feature

- The database already has a user_notes table that can be leveraged
- Notes are stored as JSONB, allowing for rich text content
- The mobile app will need to implement a note editor and viewer

---

## Summary and Recommendations

### Detailed Migration Plan

#### Phase 1: Project Setup and Environment Configuration

1. **Initialize Expo Project**

   - Create a new Expo project using the managed workflow
   - Set up TypeScript configuration
   - Configure ESLint and Prettier for code quality

2. **Design System Implementation**

   - Create a theme provider with gold and black color scheme
   - Implement base components with the design system
   - Set up responsive layouts for different screen sizes

3. **Authentication Integration**
   - Implement Clerk authentication for React Native
   - Set up secure token storage with Expo SecureStore
   - Create login/signup screens

#### Phase 2: Core Functionality Migration

1. **API Layer Implementation**

   - Create API service for backend communication
   - Implement error handling and retry logic
   - Set up environment configuration for different environments

2. **Vector Database Integration**

   - Implement AstraDB client for React Native
   - Create vector search service
   - Optimize for mobile performance and offline capabilities

3. **Chat Interface Migration**
   - Implement chat UI components
   - Migrate useChat hook functionality
   - Implement chat history storage

#### Phase 3: Feature Enhancement

1. **Note-Taking Feature Implementation**

   - Create note editor component
   - Implement note storage and synchronization
   - Add note categorization and search

2. **Tavily Alternative Integration**

   - Evaluate alternatives to Tavily for mobile
   - Implement selected search solution
   - Optimize for mobile data usage

3. **Offline Capabilities**
   - Implement caching for Bible text
   - Add offline mode for previously asked questions
   - Create sync mechanism for when connection is restored

#### Phase 4: Testing and Deployment

1. **Testing**

   - Implement unit and integration tests
   - Conduct usability testing
   - Perform performance optimization

2. **Deployment Preparation**

   - Configure Expo Application Services (EAS)
   - Set up CI/CD pipeline
   - Prepare app store assets

3. **Release**
   - Build production version
   - Deploy to Google Play Store
   - Monitor performance and user feedback

### Concise Key Takeaways

- **Architecture Shift**: Move from server-side rendering (NextJS) to client-side rendering (React Native) while maintaining core functionality
- **Database Strategy**: Continue using AstraDB for vector search but implement through a client SDK or API
- **Authentication**: Implement Clerk authentication using their React Native SDK
- **UI Adaptation**: Redesign the interface for mobile while maintaining the gold and black aesthetic
- **New Features**: Implement note-taking using the existing database schema
- **Performance Considerations**: Optimize for mobile devices with potentially limited resources
- **Offline Support**: Add caching and offline capabilities not present in the web version
- **Tavily Alternative**: Evaluate and implement a mobile-friendly alternative to Tavily search
- **Expo Advantages**: Leverage Expo's managed workflow for simplified development and deployment
- **Testing Focus**: Emphasize testing on Android devices while ensuring the architecture supports iOS for future expansion

By following this migration plan, the Bible AI Explorer can be successfully transformed from a NextJS web application to a React Native Expo mobile app while maintaining its core functionality and enhancing the user experience with mobile-specific features.
